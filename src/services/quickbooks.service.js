import OAuthClient from "intuit-oauth";
import QuickBooks from "node-quickbooks";

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

const getQboClient = (access_token, realm_id) =>
  new QuickBooks(
    QB_CLIENT_ID,
    QB_CLIENT_SECRET,
    access_token,
    false,
    realm_id,
    isSandbox,
    false,
    null,
    "2.0",
    null
  );

export const getInvoices = (access_token, realm_id, qb_customer_id) => {
  const qbo = getQboClient(access_token, realm_id);

  return new Promise((resolve, reject) => {
    qbo.findInvoices([{ field: "CustomerRef", value: qb_customer_id }], (err, data) => {
      if (err) return reject(err);
      resolve(data.QueryResponse?.Invoice ?? []);
    });
  });
};

export const getInvoiceById = (access_token, realm_id, qb_invoice_id) => {
  const qbo = getQboClient(access_token, realm_id);

  return new Promise((resolve, reject) => {
    qbo.getInvoice(qb_invoice_id, (err, data) => {
      if (err) return reject(err);
      resolve(data);
    });
  });
};

export const getPayments = (access_token, realm_id, qb_customer_id) => {
  const qbo = getQboClient(access_token, realm_id);

  return new Promise((resolve, reject) => {
    qbo.findPayments([{ field: "CustomerRef", value: qb_customer_id }], (err, data) => {
      if (err) return reject(err);
      resolve(data.QueryResponse?.Payment ?? []);
    });
  });
};
