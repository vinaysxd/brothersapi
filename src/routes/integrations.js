import https from "node:https";
import axios from "axios";
import { Router } from "express";
import QuickBooks from "node-quickbooks";
import {
  getAuthUrl,
  exchangeCodeForTokens,
  getInvoices,
  getInvoiceById,
  getPayments,
} from "../services/quickbooks.service.js";
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

    // node-quickbooks calls the shared axios module directly, so this
    // disables gzip/deflate/br only for the findCustomers() call below.
    axios.defaults.headers.common["Accept-Encoding"] = "identity";

    qbo.findCustomers(
      [{ field: "DisplayName", value: `%${name}%`, operator: "LIKE" }],
      (err, data) => {
        if (err) {
          console.error("QuickBooks customer search failed:", err.message);
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

    const { data: existingLink } = await supabase
      .from("client_profile")
      .select("id")
      .eq("qb_customer_id", qb_customer_id)
      .maybeSingle();

    if (existingLink) {
      return res.status(409).json({
        code: "QBO_004",
        message: "This QuickBooks customer is already linked to another client",
      });
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

const getLinkedQbCustomerId = async (user_id) => {
  const { data: clientProfile, error } = await supabase
    .from("client_profile")
    .select("qb_customer_id")
    .eq("profile_id", user_id)
    .maybeSingle();

  if (error || !clientProfile || !clientProfile.qb_customer_id) {
    return null;
  }

  return clientProfile.qb_customer_id;
};

const getInvoiceStatus = (invoice) => {
  const balance = invoice.Balance ?? 0;

  if (balance === 0) {
    return "PAID";
  }

  if (invoice.DueDate && new Date(invoice.DueDate) < new Date()) {
    return "OVERDUE";
  }

  return "PENDING";
};

/**
 * @swagger
 * /integrations/quickbooks/invoices:
 *   get:
 *     summary: Get all QuickBooks invoices for the authenticated client
 *     tags: [Integrations]
 *     responses:
 *       200:
 *         description: List of invoices
 *       404:
 *         description: No QuickBooks account linked
 *       500:
 *         description: Server error
 */
router.get(
  "/quickbooks/invoices",
  authenticate,
  requireRole("client"),
  qbAuth,
  async (req, res) => {
    console.log("QB auth:", req.qb);

    const qb_customer_id = await getLinkedQbCustomerId(req.user.id);
    console.log("-------qb id", qb_customer_id)
    if (!qb_customer_id) {
      return res.status(404).json({ code: "QBO_003", message: "No QuickBooks account linked" });
    }

    try {
      const invoices = await getInvoices(req.qb.access_token, req.qb.realm_id, qb_customer_id);
     console.log("INvoices",invoices)
      // const result = invoices.map((invoice) => ({
      //   id: invoice.Id,
      //   doc_number: invoice.DocNumber,
      //   due_date: invoice.DueDate,
      //   total_amount: invoice.TotalAmt,
      //   balance: invoice.Balance,
      //   status: getInvoiceStatus(invoice),
      // }));

      return res.status(200).json(invoices);
    } catch (err) {
      console.error("Failed to fetch QuickBooks invoices:", err);
      return res.status(500).json(ERRORS.SERVER_ERROR);
    }
  }
);

/**
 * @swagger
 * /integrations/quickbooks/invoices/{invoice_id}:
 *   get:
 *     summary: Get a single QuickBooks invoice for the authenticated client
 *     tags: [Integrations]
 *     parameters:
 *       - in: path
 *         name: invoice_id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Invoice detail
 *       403:
 *         description: Invoice does not belong to this client
 *       404:
 *         description: No QuickBooks account linked, or invoice not found
 *       500:
 *         description: Server error
 */
router.get(
  "/quickbooks/invoices/:invoice_id",
  authenticate,
  requireRole("client"),
  qbAuth,
  async (req, res) => {
    const qb_customer_id = await getLinkedQbCustomerId(req.user.id);

    if (!qb_customer_id) {
      return res.status(404).json({ code: "QBO_003", message: "No QuickBooks account linked" });
    }

    try {
      const invoice = await getInvoiceById(req.qb.access_token, req.qb.realm_id, req.params.invoice_id);

      if (!invoice) {
        return res.status(404).json(ERRORS.NOT_FOUND);
      }

      if (invoice.CustomerRef?.value !== qb_customer_id) {
        return res.status(403).json(ERRORS.AUTH_UNAUTHORIZED);
      }

      return res.status(200).json({
        id: invoice.Id,
        doc_number: invoice.DocNumber,
        due_date: invoice.DueDate,
        total_amount: invoice.TotalAmt,
        balance: invoice.Balance,
        status: getInvoiceStatus(invoice),
        customer_ref: invoice.CustomerRef,
        line_items: (invoice.Line ?? []).map((line) => ({
          id: line.Id,
          description: line.Description,
          amount: line.Amount,
          detail_type: line.DetailType,
        })),
      });
    } catch (err) {
      console.error("Failed to fetch QuickBooks invoice:", err);
      return res.status(500).json(ERRORS.SERVER_ERROR);
    }
  }
);

/**
 * @swagger
 * /integrations/quickbooks/invoices/{invoice_id}/pdf:
 *   get:
 *     summary: Get a QuickBooks invoice PDF for the authenticated client
 *     tags: [Integrations]
 *     parameters:
 *       - in: path
 *         name: invoice_id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Invoice PDF
 *         content:
 *           application/pdf: {}
 *       403:
 *         description: Invoice does not belong to this client
 *       404:
 *         description: No QuickBooks account linked, or invoice not found
 *       500:
 *         description: Server error
 *       502:
 *         description: Failed to fetch invoice PDF from QuickBooks
 */
router.get(
  "/quickbooks/invoices/:invoice_id/pdf",
  authenticate,
  requireRole("client"),
  qbAuth,
  async (req, res) => {
    const qb_customer_id = await getLinkedQbCustomerId(req.user.id);

    if (!qb_customer_id) {
      return res.status(404).json({ code: "QBO_003", message: "No QuickBooks account linked" });
    }

    try {
      const invoice = await getInvoiceById(req.qb.access_token, req.qb.realm_id, req.params.invoice_id);

      if (!invoice) {
        return res.status(404).json(ERRORS.NOT_FOUND);
      }

      if (invoice.CustomerRef?.value !== qb_customer_id) {
        return res.status(403).json(ERRORS.AUTH_UNAUTHORIZED);
      }
    } catch (err) {
      console.error("Failed to fetch QuickBooks invoice:", err);
      return res.status(500).json(ERRORS.SERVER_ERROR);
    }

    const hostname = isSandbox
      ? "sandbox-quickbooks.api.intuit.com"
      : "quickbooks.api.intuit.com";

    const options = {
      hostname,
      path: `/v3/company/${req.qb.realm_id}/invoice/${req.params.invoice_id}/pdf?minorversion=65`,
      method: "GET",
      headers: {
        Authorization: `Bearer ${req.qb.access_token}`,
        Accept: "application/pdf",
      },
    };

    const qbReq = https.request(options, (qbRes) => {
      if (qbRes.statusCode < 200 || qbRes.statusCode >= 300) {
        let body = "";

        qbRes.on("data", (chunk) => {
          body += chunk;
        });

        qbRes.on("end", () => {
          console.error("Failed to fetch QuickBooks invoice PDF:", body);
          res.status(502).json({ code: "QBO_004", message: "Failed to fetch invoice PDF" });
        });

        return;
      }

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="invoice-${req.params.invoice_id}.pdf"`);
      qbRes.pipe(res);
    });

    qbReq.on("error", (err) => {
      console.error("Failed to fetch QuickBooks invoice PDF:", err);
      res.status(502).json({ code: "QBO_004", message: "Failed to fetch invoice PDF" });
    });

    qbReq.end();
  }
);

/**
 * @swagger
 * /integrations/quickbooks/payments:
 *   get:
 *     summary: Get all QuickBooks payments for the authenticated client
 *     tags: [Integrations]
 *     responses:
 *       200:
 *         description: List of payments
 *       404:
 *         description: No QuickBooks account linked
 *       500:
 *         description: Server error
 */
router.get(
  "/quickbooks/payments",
  authenticate,
  requireRole("client"),
  qbAuth,
  async (req, res) => {
    const qb_customer_id = await getLinkedQbCustomerId(req.user.id);

    if (!qb_customer_id) {
      return res.status(404).json({ code: "QBO_003", message: "No QuickBooks account linked" });
    }

    try {
      const payments = await getPayments(req.qb.access_token, req.qb.realm_id, qb_customer_id);

      const result = payments.map((payment) => ({
        id: payment.Id,
        amount: payment.TotalAmt,
        date: payment.TxnDate,
        invoice_references: (payment.Line ?? [])
          .flatMap((line) => line.LinkedTxn ?? [])
          .filter((txn) => txn.TxnType === "Invoice")
          .map((txn) => txn.TxnId),
      }));

      return res.status(200).json(result);
    } catch (err) {
      console.error("Failed to fetch QuickBooks payments:", err);
      return res.status(500).json(ERRORS.SERVER_ERROR);
    }
  }
);

/**
 * @swagger
 * /integrations/quickbooks/balance:
 *   get:
 *     summary: Get the authenticated client's outstanding QuickBooks balance
 *     tags: [Integrations]
 *     responses:
 *       200:
 *         description: Balance summary
 *       404:
 *         description: No QuickBooks account linked
 *       500:
 *         description: Server error
 */
router.get(
  "/quickbooks/balance",
  authenticate,
  requireRole("client"),
  qbAuth,
  async (req, res) => {
    const qb_customer_id = await getLinkedQbCustomerId(req.user.id);

    if (!qb_customer_id) {
      return res.status(404).json({ code: "QBO_003", message: "No QuickBooks account linked" });
    }

    try {
      const invoices = await getInvoices(req.qb.access_token, req.qb.realm_id, qb_customer_id);

      let total_outstanding = 0;
      let overdue = 0;

      for (const invoice of invoices) {
        const balance = invoice.Balance ?? 0;
        total_outstanding += balance;

        if (getInvoiceStatus(invoice) === "OVERDUE") {
          overdue += balance;
        }
      }

      return res.status(200).json({
        total_outstanding,
        overdue,
        invoices_count: invoices.length,
      });
    } catch (err) {
      console.error("Failed to fetch QuickBooks balance:", err);
      return res.status(500).json(ERRORS.SERVER_ERROR);
    }
  }
);

export default router;
