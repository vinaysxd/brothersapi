import { supabase } from "../config/supabase.js";
import { refreshAccessToken } from "../services/quickbooks.service.js";

export const qbAuth = async (req, res, next) => {
  try {
    const { data: config, error } = await supabase
      .from("quickbooks_config")
      .select("*")
      .eq("singleton", true)
      .maybeSingle();

    if (error || !config) {
      return res.status(503).json({ code: "QBO_002", message: "QuickBooks not connected" });
    }

    let { access_token, refresh_token, realm_id, token_expiry } = config;

    if (new Date(token_expiry) < new Date()) {
      const refreshed = await refreshAccessToken(refresh_token);

      access_token = refreshed.access_token;
      refresh_token = refreshed.refresh_token;

      const token_expiry_new = new Date(Date.now() + 60 * 60 * 1000).toISOString();

      const { error: upsertError } = await supabase.from("quickbooks_config").upsert(
        {
          singleton: true,
          access_token,
          refresh_token,
          realm_id,
          token_expiry: token_expiry_new,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "singleton" }
      );

      if (upsertError) {
        return res.status(503).json({ code: "QBO_002", message: "QuickBooks not connected" });
      }
    }

    req.qb = { access_token, realm_id };
    return next();
  } catch (err) {
    return res.status(503).json({ code: "QBO_002", message: "QuickBooks not connected" });
  }
};
