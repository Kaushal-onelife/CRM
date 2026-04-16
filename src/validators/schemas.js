const { z } = require("zod");

// ── Auth ──────────────────────────────────────────────
const signupSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  businessName: z.string().min(2, "Business name must be at least 2 characters"),
  phone: z
    .string()
    .regex(/^\d{10}$/, "Phone must be a 10-digit number"),
  email: z.string().email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

// ── Customers ─────────────────────────────────────────
const createCustomerSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  phone: z
    .string()
    .regex(/^\d{10}$/, "Phone must be a 10-digit number"),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  address: z.string().optional().or(z.literal("")),
  city: z.string().optional().or(z.literal("")),
  purifier_brand: z.string().optional().or(z.literal("")),
  purifier_model: z.string().optional().or(z.literal("")),
  installation_date: z.string().optional().or(z.literal("")),
  notes: z.string().optional().or(z.literal("")),
});

const updateCustomerSchema = createCustomerSchema.partial();

// ── Services ──────────────────────────────────────────
const createServiceSchema = z.object({
  customer_id: z.string().uuid("Invalid customer ID"),
  service_type: z.enum(
    ["installation", "amc", "repair", "filter_change", "general_service"],
    { message: "Invalid service type" }
  ),
  scheduled_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD format"),
  amount: z.number().min(0, "Amount cannot be negative").optional().default(0),
  notes: z.string().optional().or(z.literal("")),
});

const updateServiceSchema = z.object({
  status: z
    .enum(["scheduled", "pending", "in_progress", "completed", "rejected", "cancelled"])
    .optional(),
  scheduled_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD format")
    .optional(),
  amount: z.number().min(0).optional(),
  notes: z.string().optional(),
});

const completeServiceSchema = z.object({
  next_due_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD format")
    .nullable()
    .optional(),
  service_charge: z.number().min(0, "Service charge cannot be negative").optional().default(0),
  parts_replaced: z
    .array(
      z.object({
        name: z.string(),
        cost: z.number().min(0).optional().default(0),
        quantity: z.number().int().min(1).optional().default(1),
      })
    )
    .optional()
    .default([]),
  notes: z.string().optional(),
  payment_status: z.enum(["paid", "unpaid"]).optional(),
  payment_method: z.enum(["cash", "upi", "card", "online"]).optional().nullable(),
});

// ── Bills ─────────────────────────────────────────────
const billItemSchema = z.object({
  description: z.string().min(1, "Item description is required"),
  quantity: z.number().int().min(1, "Quantity must be at least 1"),
  unit_price: z.number().min(0, "Unit price cannot be negative"),
});

const createBillSchema = z.object({
  customer_id: z.string().uuid("Invalid customer ID"),
  service_id: z.string().uuid("Invalid service ID").optional().nullable(),
  tax: z.number().min(0, "Tax cannot be negative").optional().default(0),
  items: z.array(billItemSchema).min(1, "At least one item is required"),
});

const markPaidSchema = z.object({
  payment_method: z.enum(["cash", "upi", "card", "online"], {
    message: "Payment method must be cash, upi, card, or online",
  }),
});

// ── AMC Contracts ────────────────────────────────────
const createAmcSchema = z.object({
  customer_id: z.string().uuid("Invalid customer ID"),
  plan_name: z.string().min(1, "Plan name is required"),
  start_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Start date must be YYYY-MM-DD format"),
  end_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "End date must be YYYY-MM-DD format"),
  total_services: z.number().int().min(1, "Must include at least 1 service").optional().default(4),
  amount: z.number().min(0, "Amount cannot be negative").optional().default(0),
  notes: z.string().optional().or(z.literal("")),
  auto_schedule: z.boolean().optional().default(true),
});

const updateAmcSchema = z.object({
  plan_name: z.string().min(1).optional(),
  end_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  total_services: z.number().int().min(1).optional(),
  amount: z.number().min(0).optional(),
  payment_status: z.enum(["unpaid", "partial", "paid"]).optional(),
  status: z.enum(["active", "expired", "cancelled"]).optional(),
  notes: z.string().optional(),
});

// ── Parts Inventory ──────────────────────────────────
const createPartSchema = z.object({
  name: z.string().min(1, "Part name is required"),
  sku: z.string().optional().or(z.literal("")),
  quantity: z.number().int().min(0, "Quantity cannot be negative").optional().default(0),
  min_stock: z.number().int().min(0).optional().default(5),
  unit_price: z.number().min(0, "Price cannot be negative").optional().default(0),
  cost_price: z.number().min(0, "Cost cannot be negative").optional().default(0),
});

const updatePartSchema = createPartSchema.partial();

module.exports = {
  signupSchema,
  loginSchema,
  createCustomerSchema,
  updateCustomerSchema,
  createServiceSchema,
  updateServiceSchema,
  completeServiceSchema,
  createBillSchema,
  markPaidSchema,
  createAmcSchema,
  updateAmcSchema,
  createPartSchema,
  updatePartSchema,
};
