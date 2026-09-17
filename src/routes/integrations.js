import { Router } from "express";
import { getAuthUrl, exchangeCodeForTokens } from "../services/quickbooks.service.js";

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

export default router;
