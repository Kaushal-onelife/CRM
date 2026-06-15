// Minimal, dependency-free CSV parse/serialize.
// Handles quoted fields, embedded commas/quotes/newlines, and CRLF or LF.
// Good enough for customer import/export; not a full RFC-4180 streaming parser.

// Serialize an array of objects to a CSV string given an ordered column list.
// columns: [{ key, header }]
function toCsv(rows, columns) {
  const escape = (val) => {
    if (val === null || val === undefined) return "";
    const s = String(val);
    // Quote if the value contains a comma, quote, or newline.
    if (/[",\r\n]/.test(s)) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const header = columns.map((c) => escape(c.header || c.key)).join(",");
  const lines = rows.map((row) =>
    columns.map((c) => escape(row[c.key])).join(",")
  );
  return [header, ...lines].join("\r\n");
}

// Parse a CSV string into an array of row objects keyed by the header row.
// Returns { headers: string[], rows: object[] }.
function parseCsv(text) {
  if (!text || !text.trim()) return { headers: [], rows: [] };

  // Strip a UTF-8 BOM if Excel added one.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const records = [];
  let field = "";
  let record = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i++; // skip the escaped quote
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      record.push(field);
      field = "";
    } else if (ch === "\r") {
      // handled by the \n branch (skip lone \r)
      if (next !== "\n") {
        record.push(field);
        records.push(record);
        field = "";
        record = [];
      }
    } else if (ch === "\n") {
      record.push(field);
      records.push(record);
      field = "";
      record = [];
    } else {
      field += ch;
    }
  }
  // Flush the final field/record if the file didn't end with a newline.
  if (field.length > 0 || record.length > 0) {
    record.push(field);
    records.push(record);
  }

  if (records.length === 0) return { headers: [], rows: [] };

  const headers = records[0].map((h) => h.trim());
  const rows = [];
  for (let r = 1; r < records.length; r++) {
    const cells = records[r];
    // Skip fully empty lines.
    if (cells.length === 1 && cells[0].trim() === "") continue;
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = cells[idx] !== undefined ? cells[idx].trim() : "";
    });
    rows.push(obj);
  }

  return { headers, rows };
}

module.exports = { toCsv, parseCsv };
