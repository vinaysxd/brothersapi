import swaggerJSDoc from "swagger-jsdoc";

const options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Brothers Cleaning API",
      version: "1.0.0",
      description: "API for managing staff, clients, sites, attendance and site notes.",
    },
    servers: [{ url: "http://localhost:3000", description: "Local server" }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
      },
      schemas: {
        ErrorResponse: {
          type: "object",
          properties: {
            code: { type: "string", example: "SRV_001" },
            message: { type: "string", example: "Internal server error" },
          },
        },
        AuthUser: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            email: { type: "string", format: "email" },
            role: { type: "string", enum: ["admin", "staff", "client"], nullable: true },
          },
        },
        Profile: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            email: { type: "string", format: "email" },
            full_name: { type: "string" },
            phone: { type: "string" },
            role: { type: "string", enum: ["admin", "staff", "client"] },
            avatar_url: { type: "string", nullable: true },
            is_active: { type: "boolean" },
          },
        },
        StaffProfile: {
          allOf: [
            { $ref: "#/components/schemas/Profile" },
            {
              type: "object",
              properties: {
                profile_id: { type: "string", format: "uuid" },
                employee_id: { type: "string", nullable: true },
                address: { type: "string", nullable: true },
                emergency_contact: { type: "string", nullable: true },
              },
            },
          ],
        },
        ClientProfile: {
          allOf: [
            { $ref: "#/components/schemas/Profile" },
            {
              type: "object",
              properties: {
                profile_id: { type: "string", format: "uuid" },
                company_name: { type: "string", nullable: true },
                billing_address: { type: "string", nullable: true },
                contact_person: { type: "string", nullable: true },
              },
            },
          ],
        },
        Site: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            name: { type: "string" },
            address: { type: "string" },
            latitude: { type: "number", format: "float" },
            longitude: { type: "number", format: "float" },
            client_id: { type: "string", format: "uuid" },
            created_by: { type: "string", format: "uuid" },
            is_active: { type: "boolean" },
          },
        },
        SiteWithClient: {
          allOf: [
            { $ref: "#/components/schemas/Site" },
            {
              type: "object",
              properties: {
                client: {
                  type: "object",
                  nullable: true,
                  properties: {
                    id: { type: "string", format: "uuid" },
                    full_name: { type: "string" },
                    email: { type: "string", format: "email" },
                    phone: { type: "string" },
                    company_name: { type: "string", nullable: true },
                    billing_address: { type: "string", nullable: true },
                    contact_person: { type: "string", nullable: true },
                  },
                },
              },
            },
          ],
        },
        Attendance: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            staff_id: { type: "string", format: "uuid" },
            site_id: { type: "string", format: "uuid" },
            clock_in: { type: "string", format: "date-time" },
            clock_in_lat: { type: "number", format: "float" },
            clock_in_lng: { type: "number", format: "float" },
            clock_out: { type: "string", format: "date-time", nullable: true },
            clock_out_lat: { type: "number", format: "float", nullable: true },
            clock_out_lng: { type: "number", format: "float", nullable: true },
          },
        },
        AttendanceWithDetails: {
          allOf: [
            { $ref: "#/components/schemas/Attendance" },
            {
              type: "object",
              properties: {
                site: { $ref: "#/components/schemas/Site" },
                staff: { $ref: "#/components/schemas/Profile" },
                photos: {
                  type: "array",
                  items: { $ref: "#/components/schemas/AttendancePhoto" },
                },
              },
            },
          ],
        },
        AttendancePhoto: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            attendance_id: { type: "string", format: "uuid" },
            label: { type: "string" },
            before_photo_url: { type: "string", nullable: true },
            after_photo_url: { type: "string", nullable: true },
          },
        },
        SiteNote: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            author_id: { type: "string", format: "uuid" },
            site_id: { type: "string", format: "uuid" },
            note: { type: "string" },
            type: { type: "string", enum: ["staff", "client"] },
            created_at: { type: "string", format: "date-time" },
          },
        },
        SiteNoteWithAuthor: {
          allOf: [
            { $ref: "#/components/schemas/SiteNote" },
            {
              type: "object",
              properties: {
                author: {
                  type: "object",
                  nullable: true,
                  properties: {
                    id: { type: "string", format: "uuid" },
                    full_name: { type: "string" },
                    email: { type: "string", format: "email" },
                    phone: { type: "string" },
                    role: { type: "string", enum: ["admin", "staff", "client"] },
                  },
                },
              },
            },
          ],
        },
      },
    },
    security: [{ bearerAuth: [] }],
  },
  apis: ["./src/routes/*.js"],
};

export const swaggerSpec = swaggerJSDoc(options);
