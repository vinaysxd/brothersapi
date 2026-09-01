import { ERRORS } from "../constants/errors.js";

export const errorHandler = (err, req, res, next) => {
  console.error(err);

  if (err.name === "ZodError" || err.name === "ValidationError") {
    return res.status(400).json(ERRORS.VALIDATION_ERROR);
  }

  return res.status(500).json(ERRORS.SERVER_ERROR);
};
