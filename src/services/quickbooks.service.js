import https from "node:https";
import OAuthClient from "intuit-oauth";

const { QB_CLIENT_ID, QB_CLIENT_SECRET, QB_REDIRECT_URI, QB_ENVIRONMENT } = process.env;

const isSandbox = QB_ENVIRONMENT !== "production";

export const initOAuthClient = () => {
  console.log("QuickBooks OAuth redirectUri:", QB_REDIRECT_URI);

  return new OAuthClient({
    clientId: QB_CLIENT_ID,
    clientSecret: QB_CLIENT_SECRET,
    environment: QB_ENVIRONMENT,
    redirectUri: QB_REDIRECT_URI,
  });
};

export const getAuthUrl = () => {
  const oauthClient = initOAuthClient();

  const authUrl = oauthClient.authorizeUri({
    scope: [OAuthClient.scopes.Accounting],
    state: "brothers-cleaning-qb",
  });

  console.log("QuickBooks auth URL:", authUrl);

  return authUrl;
};

export const exchangeCodeForTokens = async (url) => {
  const oauthClient = initOAuthClient();
  await oauthClient.createToken(url);

  const token = oauthClient.getToken();

  return {
    access_token: token.access_token,
    refresh_token: token.refresh_token,
    realm_id: token.realmId,
  };
};

export const refreshAccessToken = async (refresh_token) => {
  const oauthClient = initOAuthClient();
  await oauthClient.refreshUsingToken(refresh_token);

  const token = oauthClient.getToken();

  return {
    access_token: token.access_token,
    refresh_token: token.refresh_token,
    realm_id: token.realmId,
  };
};

const escapeQboString = (value) => String(value).replace(/'/g, "\\'");

const qboRequest = (access_token, path, useSandbox = isSandbox) => {
  const hostname = useSandbox
    ? "sandbox-quickbooks.api.intuit.com"
    : "quickbooks.api.intuit.com";

  const options = {
    hostname,
    path,
    method: "GET",
    headers: {
      Authorization: `Bearer ${access_token}`,
      Accept: "application/json",
    },
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let body = "";

      res.on("data", (chunk) => {
        body += chunk;
      });

      res.on("end", () => {
        let json;

        try {
          json = JSON.parse(body);
        } catch (err) {
          return reject(err);
        }

        if (res.statusCode < 200 || res.statusCode >= 300 || json.Fault) {
          return reject(json);
        }

        resolve(json);
      });
    });

    req.on("error", reject);
    req.end();
  });
};

export const getInvoices = async (access_token, realm_id, qb_customer_id, useSandbox = isSandbox) => {
  const query = `select * from Invoice where CustomerRef = '${escapeQboString(qb_customer_id)}' orderby TxnDate desc maxresults 10`;
  const path = `/v3/company/${realm_id}/query?query=${encodeURIComponent(query)}&minorversion=65`;

  const data = await qboRequest(access_token, path, useSandbox);

  return data.QueryResponse?.Invoice ?? [];
};

export const getInvoiceById = async (access_token, realm_id, qb_invoice_id, useSandbox = isSandbox) => {
  const path = `/v3/company/${realm_id}/invoice/${qb_invoice_id}?minorversion=65`;

  const data = await qboRequest(access_token, path, useSandbox);

  return data.Invoice ?? null;
};

export const getPayments = async (access_token, realm_id, qb_customer_id, useSandbox = isSandbox) => {
  const query = `select * from Payment where CustomerRef = '${escapeQboString(qb_customer_id)}'`;
  const path = `/v3/company/${realm_id}/query?query=${encodeURIComponent(query)}&minorversion=65`;

  const data = await qboRequest(access_token, path, useSandbox);

  return data.QueryResponse?.Payment ?? [];
};
