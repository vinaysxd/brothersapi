import { ERRORS } from "../constants/errors.js";

export const requireRole = (...roles) => {
  return (req, res, next) => {
    const role = req.user?.app_metadata?.role;

    if (!role || !roles.includes(role)) {
      return res.status(403).json(ERRORS.AUTH_UNAUTHORIZED);
    }

    next();
  };
};
