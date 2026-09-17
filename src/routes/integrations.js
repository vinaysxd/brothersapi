import { Router } from "express";
import QuickBooks from "node-quickbooks";
import { getAuthUrl, exchangeCodeForTokens } from "../services/quickbooks.service.js";
import { supabase } from "../config/supabase.js";
import { authenticate } from "../middleware/auth.js";
import { requireRole } from "../middleware/role.js";
import { qbAuth } from "../middleware/qbAuth.js";
import { ERRORS } from "../constants/errors.js";

const { QB_CLIENT_ID, QB_CLIENT_SECRET, QB_ENVIRONMENT } = process.env;
const isSandbox = QB_ENVIRONMENT !== "production";

const router = Router();

/**
 * @swagger
 * /integrations/quickbooks/connect:
 *   get:
 *     summary: Redirect to the QuickBooks Online authorization page
 *     tags: [Integrations]
 *     responses:
 *       302:
 *         description: Redirect to QuickBooks authorization URL
 */
router.get("/quickbooks/connect", (req, res) => {
  const authUrl = getAuthUrl();
  return res.redirect(authUrl);
});

/**
 * @swagger
 * /integrations/quickbooks/callback:
 *   get:
 *     summary: Handle the QuickBooks OAuth callback and exchange the auth code for tokens
 *     tags: [Integrations]
 *     responses:
 *       200:
 *         description: Tokens exchanged successfully
 *       500:
 *         description: Token exchange failed
 */
router.get("/quickbooks/callback", async (req, res) => {
  try {
    const fullUrl = `${req.protocol}://${req.get("host")}${req.originalUrl}`;
    const { access_token, refresh_token, realm_id } = await exchangeCodeForTokens(fullUrl);

    console.log("QuickBooks tokens received:", { access_token, refresh_token, realm_id });

    const token_expiry = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    const { error } = await supabase.from("quickbooks_config").upsert(
      {
        singleton: true,
        access_token,
        refresh_token,
        realm_id,
        token_expiry,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "singleton" }
    );

    if (error) {
      console.error("Failed to save QuickBooks tokens:", error);
      return res.status(500).json({ code: "QBO_001", message: "QuickBooks token exchange failed" });
    }

    return res.status(200).json({ message: "QuickBooks connected successfully" });
  } catch (error) {
    console.error("QuickBooks token exchange failed:", error);
    return res.status(500).json({ code: "QBO_001", message: "QuickBooks token exchange failed" });
  }
});

/**
 * @swagger
 * /integrations/quickbooks/status:
 *   get:
 *     summary: Get QuickBooks connection status
 *     tags: [Integrations]
 *     responses:
 *       200:
 *         description: Connection status
 */
router.get("/quickbooks/status", (req, res) => {
  return res.status(200).json({ connected: false });
});

/**
 * @swagger
 * /integrations/quickbooks/customers/search:
 *   get:
 *     summary: Search QuickBooks customers by display name
 *     tags: [Integrations]
 *     parameters:
 *       - in: query
 *         name: name
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Matching customers
 *       400:
 *         description: Validation error
 *       403:
 *         description: Caller is not an admin
 *       503:
 *         description: QuickBooks not connected
 */
router.get(
  "/quickbooks/customers/search",
  authenticate,
  requireRole("admin"),
  qbAuth,
  async (req, res) => {
    const { name } = req.query;

    if (!name) {
      return res.status(400).json(ERRORS.VALIDATION_ERROR);
    }

    const qbo = new QuickBooks(
      QB_CLIENT_ID,
      QB_CLIENT_SECRET,
      req.qb.access_token,
      false,
      req.qb.realm_id,
      isSandbox,
      false,
      null,
      "2.0",
      null
    );

    qbo.findCustomers(
      [{ field: "DisplayName", value: `%${name}%`, operator: "LIKE" }],
      (err, data) => {
        if (err) {
          console.error("QuickBooks customer search failed:", err);
          return res.status(500).json({ code: "QBO_003", message: "QuickBooks customer search failed" });
        }

        const customers = (data.QueryResponse?.Customer ?? []).map((customer) => ({
          qb_customer_id: customer.Id,
          name: customer.DisplayName,
          email: customer.PrimaryEmailAddr?.Address,
        }));

        return res.status(200).json(customers);
      }
    );
  }
);

/**
 * @swagger
 * /integrations/quickbooks/clients/{client_id}/link:
 *   patch:
 *     summary: Link a client_profile row to a QuickBooks customer
 *     tags: [Integrations]
 *     parameters:
 *       - in: path
 *         name: client_id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [qb_customer_id]
 *             properties:
 *               qb_customer_id: { type: string }
 *     responses:
 *       200:
 *         description: Updated client row
 *       400:
 *         description: Validation error
 *       403:
 *         description: Caller is not an admin
 *       404:
 *         description: Client not found
 *       500:
 *         description: Server error
 */
router.patch(
  "/quickbooks/clients/:client_id/link",
  authenticate,
  requireRole("admin"),
  async (req, res) => {
    const { client_id } = req.params;
    const { qb_customer_id } = req.body;
    
    if (qb_customer_id === undefined) {
      return res.status(400).json(ERRORS.VALIDATION_ERROR);
    }

    const { data: clientProfile, error: fetchError } = await supabase
      .from("client_profile")
      .select("id")
      .eq("profile_id", client_id)
      .maybeSingle();
   console.log("CLIENT PROIFLE",clientProfile)
    if (fetchError || !clientProfile) {
      return res.status(404).json(ERRORS.USER_NOT_FOUND);
    }

    const { data: client, error } = await supabase
      .from("client_profile")
      .update({ qb_customer_id })
      .eq("id", clientProfile.id)
      .select()
      .maybeSingle();

    if (error) {
      return res.status(500).json(ERRORS.SERVER_ERROR);
    }

    if (!client) {
      return res.status(404).json(ERRORS.USER_NOT_FOUND);
    }

    return res.status(200).json({ client });
  }
);

export default router;
