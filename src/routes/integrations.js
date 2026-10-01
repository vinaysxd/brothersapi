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
  getAllInvoices,
  getCustomerInvoicesAll,
  createInvoice,
  createPayment,
  getAllEstimates,
  getAllPayments,
  findCustomerIdByEmail,
  getCustomerEstimates,
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
  const authUrl = getAuthUrl(req.query.platform === "web" ? "web" : "mobile");
  return res.redirect(authUrl);
});

/**
 * @swagger
 * /integrations/quickbooks/callback:
 *   get:
 *     summary: Handle the QuickBooks OAuth callback and exchange the auth code for tokens
 *     tags: [Integrations]
 *     responses:
 *       302:
 *         description: Tokens exchanged successfully; redirects to the app deep link (brothers://integrations/quickbooks)
 *       500:
 *         description: Token exchange failed
 */
router.get("/quickbooks/callback", async (req, res) => {
  try {
    const fullUrl = `${req.protocol}://${req.get("host")}${req.originalUrl}`;
    const { access_token, refresh_token, realm_id } = await exchangeCodeForTokens(fullUrl);

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

    // The platform is carried through the OAuth state set in /quickbooks/connect.
    if (String(req.query.state ?? "").endsWith(":web")) {
      return res.redirect("http://localhost:3000/admin/settings?qb=connected");
    }

    // Deep link back into the app so the in-app auth browser session closes itself.
    return res.redirect("brothers://integrations/quickbooks");
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
 *     summary: List QuickBooks invoices (admin - all invoices; client - own invoices)
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
  requireRole("client", "admin"),
  qbAuth,
  async (req, res) => {
    if (req.user.app_metadata?.role === "admin") {
      try {
        const invoices = await getAllInvoices(req.qb.access_token, req.qb.realm_id);
        return res.status(200).json(invoices);
      } catch (err) {
        console.error("Failed to fetch QuickBooks invoices:", err);
        return res.status(500).json(ERRORS.SERVER_ERROR);
      }
    }

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
 *     summary: List QuickBooks payments (admin - all payments; client - own payments)
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
  requireRole("client", "admin"),
  qbAuth,
  async (req, res) => {
    if (req.user.app_metadata?.role === "admin") {
      try {
        const payments = await getAllPayments(req.qb.access_token, req.qb.realm_id);
        return res.status(200).json(payments);
      } catch (err) {
        console.error("Failed to fetch QuickBooks payments:", err);
        return res.status(500).json(ERRORS.SERVER_ERROR);
      }
    }

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

const getClientQbCustomerId = async (client_id) => {
  const { data, error } = await supabase
    .from("client_profile")
    .select("qb_customer_id")
    .eq("profile_id", client_id)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data?.qb_customer_id ?? null;
};

// Maps request line items [{ description, amount, qty?, unit_price? }] to QBO sales lines.
const buildSalesLines = (line_items) => {
  if (!Array.isArray(line_items) || line_items.length === 0) {
    return null;
  }

  const lines = [];

  for (const item of line_items) {
    const qty = item.qty === undefined ? 1 : Number(item.qty);
    const unit_price = item.unit_price === undefined ? Number(item.amount) : Number(item.unit_price);
    const amount = item.amount === undefined ? qty * unit_price : Number(item.amount);

    if (!item.description || [qty, unit_price, amount].some((n) => !Number.isFinite(n))) {
      return null;
    }

    lines.push({
      DetailType: "SalesItemLineDetail",
      Description: item.description,
      Amount: amount,
      SalesItemLineDetail: {
        Qty: qty,
        UnitPrice: unit_price,
        ...(item.item_id && { ItemRef: { value: String(item.item_id) } }),
      },
    });
  }

  return lines;
};

const buildBillingDocument = (body, qb_customer_id, extra = {}) => {
  const Line = buildSalesLines(body.line_items);

  if (!Line) {
    return null;
  }

  return {
    CustomerRef: { value: qb_customer_id },
    Line,
    ...(body.memo && { CustomerMemo: { value: body.memo } }),
    ...(body.email && { BillEmail: { Address: body.email } }),
    ...extra,
  };
};

/**
 * @swagger
 * /integrations/quickbooks/invoices:
 *   post:
 *     summary: Create a QuickBooks invoice for a client
 *     tags: [Integrations]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [client_id, line_items]
 *             properties:
 *               client_id: { type: string, format: uuid, description: Client profile id }
 *               line_items:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [description]
 *                   properties:
 *                     description: { type: string }
 *                     amount: { type: number }
 *                     qty: { type: number }
 *                     unit_price: { type: number }
 *                     item_id: { type: string }
 *               due_date: { type: string, format: date }
 *               memo: { type: string }
 *     responses:
 *       201:
 *         description: Invoice created
 *       400:
 *         description: Validation error
 *       403:
 *         description: Caller is not an admin
 *       404:
 *         description: Client not found or not linked to QuickBooks
 *       500:
 *         description: Server error
 */
router.post(
  "/quickbooks/invoices",
  authenticate,
  requireRole("admin"),
  qbAuth,
  async (req, res) => {
    const { client_id, due_date } = req.body;

    if (!client_id) {
      return res.status(400).json(ERRORS.VALIDATION_ERROR);
    }

    try {
      const qb_customer_id = await getClientQbCustomerId(client_id);

      if (!qb_customer_id) {
        return res.status(404).json({ code: "QBO_003", message: "No QuickBooks account linked" });
      }

      const payload = buildBillingDocument(req.body, qb_customer_id, due_date ? { DueDate: due_date } : {});

      if (!payload) {
        return res.status(400).json(ERRORS.VALIDATION_ERROR);
      }

      const invoice = await createInvoice(req.qb.access_token, req.qb.realm_id, payload);

      return res.status(201).json(invoice);
    } catch (err) {
      console.error("Failed to create QuickBooks invoice:", JSON.stringify(err?.Fault ?? err?.message ?? err));
      return res.status(500).json(ERRORS.SERVER_ERROR);
    }
  }
);

/**
 * @swagger
 * /integrations/quickbooks/estimates:
 *   get:
 *     summary: List quotes/estimates from QuickBooks (read-only)
 *     tags: [Integrations]
 *     responses:
 *       200:
 *         description: List of estimates
 *       403:
 *         description: Caller is not an admin
 *       500:
 *         description: Server error
 */
router.get(
  "/quickbooks/estimates",
  authenticate,
  requireRole("admin"),
  qbAuth,
  async (req, res) => {
    try {
      const estimates = await getAllEstimates(req.qb.access_token, req.qb.realm_id);
      return res.status(200).json(estimates);
    } catch (err) {
      console.error("Failed to fetch QuickBooks estimates:", JSON.stringify(err?.Fault ?? err?.message ?? err));
      return res.status(500).json(ERRORS.SERVER_ERROR);
    }
  }
);

/**
 * @swagger
 * /integrations/quickbooks/statements/{customerId}:
 *   get:
 *     summary: Get all invoices for a QuickBooks customer
 *     tags: [Integrations]
 *     parameters:
 *       - in: path
 *         name: customerId
 *         required: true
 *         schema: { type: string }
 *         description: QuickBooks customer id
 *     responses:
 *       200:
 *         description: Invoices for the customer
 *       403:
 *         description: Caller is not an admin
 *       500:
 *         description: Server error
 */
router.get(
  "/quickbooks/statements/:customerId",
  authenticate,
  requireRole("admin"),
  qbAuth,
  async (req, res) => {
    try {
      const invoices = await getCustomerInvoicesAll(
        req.qb.access_token,
        req.qb.realm_id,
        req.params.customerId
      );

      return res.status(200).json(invoices);
    } catch (err) {
      console.error("Failed to fetch QuickBooks statement:", JSON.stringify(err?.Fault ?? err?.message ?? err));
      return res.status(500).json(ERRORS.SERVER_ERROR);
    }
  }
);

/**
 * @swagger
 * /integrations/quickbooks/payments:
 *   post:
 *     summary: Record a QuickBooks payment against an invoice
 *     tags: [Integrations]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [customer_id, invoice_id, amount]
 *             properties:
 *               customer_id: { type: string, description: QuickBooks customer id }
 *               invoice_id: { type: string, description: QuickBooks invoice id }
 *               amount: { type: number }
 *               payment_date: { type: string, format: date }
 *     responses:
 *       201:
 *         description: Payment recorded
 *       400:
 *         description: Validation error
 *       403:
 *         description: Caller is not an admin
 *       500:
 *         description: Server error
 */
router.post(
  "/quickbooks/payments",
  authenticate,
  requireRole("admin"),
  qbAuth,
  async (req, res) => {
    const { customer_id, invoice_id, amount, payment_date } = req.body;
    const total = Number(amount);

    if (!customer_id || !invoice_id || !Number.isFinite(total) || total <= 0) {
      return res.status(400).json(ERRORS.VALIDATION_ERROR);
    }

    try {
      const payment = await createPayment(req.qb.access_token, req.qb.realm_id, {
        CustomerRef: { value: String(customer_id) },
        TotalAmt: total,
        ...(payment_date && { TxnDate: payment_date }),
        Line: [
          {
            Amount: total,
            LinkedTxn: [{ TxnId: String(invoice_id), TxnType: "Invoice" }],
          },
        ],
      });

      return res.status(201).json(payment);
    } catch (err) {
      console.error("Failed to record QuickBooks payment:", JSON.stringify(err?.Fault ?? err?.message ?? err));
      return res.status(500).json(ERRORS.SERVER_ERROR);
    }
  }
);

// Resolves the logged-in client's QuickBooks customer id: the linked client_profile
// row first, otherwise a QuickBooks customer whose PrimaryEmailAddr matches their email.
const resolveClientQbCustomerId = async (req) => {
  const linked = await getLinkedQbCustomerId(req.user.id);

  if (linked) {
    return linked;
  }

  if (!req.user.email) {
    return null;
  }

  return findCustomerIdByEmail(req.qb.access_token, req.qb.realm_id, req.user.email);
};

/**
 * @swagger
 * /integrations/quickbooks/client/invoices:
 *   get:
 *     summary: Get the logged-in client's invoices from QuickBooks
 *     tags: [Integrations]
 *     responses:
 *       200:
 *         description: List of invoices
 *       403:
 *         description: Caller is not a client
 *       404:
 *         description: No matching QuickBooks customer
 *       500:
 *         description: Server error
 */
router.get(
  "/quickbooks/client/invoices",
  authenticate,
  requireRole("client"),
  qbAuth,
  async (req, res) => {
    try {
      const qb_customer_id = await resolveClientQbCustomerId(req);

      if (!qb_customer_id) {
        return res.status(404).json({ code: "QBO_003", message: "No QuickBooks account linked" });
      }

      const invoices = await getCustomerInvoicesAll(req.qb.access_token, req.qb.realm_id, qb_customer_id);

      return res.status(200).json(invoices);
    } catch (err) {
      console.error("Failed to fetch QuickBooks client invoices:", JSON.stringify(err?.Fault ?? err?.message ?? err));
      return res.status(500).json(ERRORS.SERVER_ERROR);
    }
  }
);

/**
 * @swagger
 * /integrations/quickbooks/client/estimates:
 *   get:
 *     summary: Get the logged-in client's quotes/estimates from QuickBooks (read-only)
 *     tags: [Integrations]
 *     responses:
 *       200:
 *         description: List of estimates
 *       403:
 *         description: Caller is not a client
 *       404:
 *         description: No matching QuickBooks customer
 *       500:
 *         description: Server error
 */
router.get(
  "/quickbooks/client/estimates",
  authenticate,
  requireRole("client"),
  qbAuth,
  async (req, res) => {
    try {
      const qb_customer_id = await resolveClientQbCustomerId(req);

      if (!qb_customer_id) {
        return res.status(404).json({ code: "QBO_003", message: "No QuickBooks account linked" });
      }

      const estimates = await getCustomerEstimates(req.qb.access_token, req.qb.realm_id, qb_customer_id);

      return res.status(200).json(estimates);
    } catch (err) {
      console.error("Failed to fetch QuickBooks client estimates:", JSON.stringify(err?.Fault ?? err?.message ?? err));
      return res.status(500).json(ERRORS.SERVER_ERROR);
    }
  }
);

/**
 * @swagger
 * /integrations/quickbooks/client/statement:
 *   get:
 *     summary: Get the logged-in client's statement (invoices and payments) from QuickBooks
 *     tags: [Integrations]
 *     responses:
 *       200:
 *         description: Client statement
 *       403:
 *         description: Caller is not a client
 *       404:
 *         description: No matching QuickBooks customer
 *       500:
 *         description: Server error
 */
router.get(
  "/quickbooks/client/statement",
  authenticate,
  requireRole("client"),
  qbAuth,
  async (req, res) => {
    try {
      const qb_customer_id = await resolveClientQbCustomerId(req);

      if (!qb_customer_id) {
        return res.status(404).json({ code: "QBO_003", message: "No QuickBooks account linked" });
      }

      const { access_token, realm_id } = req.qb;
      const [invoices, payments] = await Promise.all([
        getCustomerInvoicesAll(access_token, realm_id, qb_customer_id),
        getPayments(access_token, realm_id, qb_customer_id),
      ]);

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
        qb_customer_id,
        total_outstanding,
        overdue,
        invoices,
        payments,
      });
    } catch (err) {
      console.error("Failed to fetch QuickBooks client statement:", JSON.stringify(err?.Fault ?? err?.message ?? err));
      return res.status(500).json(ERRORS.SERVER_ERROR);
    }
  }
);

export default router;
