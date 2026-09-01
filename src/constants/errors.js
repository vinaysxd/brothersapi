export const ERRORS = {
  // Auth
  AUTH_NO_TOKEN: { code: "AUTH_001", message: "No token provided" },
  AUTH_INVALID_TOKEN: { code: "AUTH_002", message: "Invalid or expired token" },
  AUTH_UNAUTHORIZED: { code: "AUTH_003", message: "Unauthorized access" },
  AUTH_INVALID_CREDENTIALS: { code: "AUTH_004", message: "Invalid email or password" },
  AUTH_INVALID_REFRESH_TOKEN: { code: "AUTH_005", message: "Invalid or expired refresh token" },

  // Validation
  VALIDATION_ERROR: { code: "VAL_001", message: "Validation error" },

  // User
  USER_NOT_FOUND: { code: "USR_001", message: "User not found" },
  USER_ALREADY_EXISTS: { code: "USR_002", message: "User already exists" },

  // Site
  SITE_NOT_FOUND: { code: "STE_001", message: "Site not found" },
  SITE_STAFF_ALREADY_ASSIGNED: { code: "STE_002", message: "Staff already assigned to this site" },

  // Attendance
  ATTENDANCE_OUT_OF_RANGE: { code: "ATT_001", message: "You are not within 100 metres of the site" },
  ATTENDANCE_ALREADY_CLOCKED_IN: { code: "ATT_002", message: "Already clocked in" },
  ATTENDANCE_NOT_CLOCKED_IN: { code: "ATT_003", message: "Not clocked in" },
  ATTENDANCE_PHOTO_PAIR_REQUIRED: { code: "ATT_004", message: "Before and after photos are required" },

  // General
  SERVER_ERROR: { code: "SRV_001", message: "Internal server error" },
  NOT_FOUND: { code: "SRV_002", message: "Resource not found" },
};