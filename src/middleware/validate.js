function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      const errors = result.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      }));

      return res.status(400).json({
        error: errors[0].message,
        errors,
      });
    }

    // Replace req.body with parsed+validated data (applies defaults, strips unknown fields)
    req.body = result.data;
    next();
  };
}

module.exports = validate;
