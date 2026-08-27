import { supabase } from "../config/supabase.js";
import { ERRORS } from "../constants/errors.js";

export const authenticate = async (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) {
    return res.status(401).json(ERRORS.AUTH_NO_TOKEN);
  }

  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data.user) {
    return res.status(401).json(ERRORS.AUTH_INVALID_TOKEN);
  }

  req.user = data.user;
  next();
};
// ^dxqfhDj7$Q9KG$