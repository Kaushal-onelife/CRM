// Mock Supabase client that mimics the chainable query builder API
// Uses in-memory data from mockData.js

const { tables, TENANT_ID, USER_ID } = require("./mockData");
const { v4: uuidv4 } = require("uuid");

// Simple UUID generator fallback if uuid not installed
function generateId() {
  try {
    return uuidv4();
  } catch {
    return "id-" + Date.now() + "-" + Math.random().toString(36).substring(2, 9);
  }
}

// Deep clone to avoid mutation
function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

// Get the join table and fields from a select like "*, customers(name, phone)"
function parseSelect(selectStr) {
  const joins = {};
  const joinRegex = /(\w+)\(([^)]+)\)/g;
  let match;
  while ((match = joinRegex.exec(selectStr)) !== null) {
    joins[match[1]] = match[2].split(",").map((s) => s.trim());
  }
  return joins;
}

// Resolve joined data on a record
function resolveJoins(record, joins, foreignKeyMap) {
  const result = clone(record);
  for (const [joinTable, fields] of Object.entries(joins)) {
    // If the record already has inline join data, keep it
    if (result[joinTable] && typeof result[joinTable] === "object") {
      continue;
    }
    // Otherwise try to resolve from tables
    const fk = foreignKeyMap[joinTable] || `${joinTable.replace(/s$/, "")}_id`;
    const fkValue = result[fk];
    if (fkValue && tables[joinTable]) {
      const related = tables[joinTable].find((r) => r.id === fkValue);
      if (related) {
        const joinData = {};
        for (const field of fields) {
          if (field === "*") {
            Object.assign(joinData, clone(related));
          } else {
            joinData[field] = related[field];
          }
        }
        result[joinTable] = joinData;
      }
    }
  }
  return result;
}

class MockQueryBuilder {
  constructor(tableName) {
    this._table = tableName;
    this._data = clone(tables[tableName] || []);
    this._filters = [];
    this._selectStr = "*";
    this._countMode = false;
    this._headMode = false;
    this._orderCol = null;
    this._orderAsc = true;
    this._rangeFrom = null;
    this._rangeTo = null;
    this._limitNum = null;
    this._singleMode = false;
    this._operation = "select"; // select, insert, update, delete
    this._insertData = null;
    this._updateData = null;
    this._joins = {};
  }

  select(selectStr = "*", options = {}) {
    this._selectStr = selectStr;
    this._joins = parseSelect(selectStr);
    if (options.count === "exact") this._countMode = true;
    if (options.head) this._headMode = true;
    return this;
  }

  insert(data) {
    this._operation = "insert";
    this._insertData = Array.isArray(data) ? data : [data];
    return this;
  }

  update(data) {
    this._operation = "update";
    this._updateData = data;
    return this;
  }

  delete() {
    this._operation = "delete";
    return this;
  }

  eq(col, val) {
    this._filters.push((row) => row[col] === val);
    return this;
  }

  in(col, vals) {
    this._filters.push((row) => vals.includes(row[col]));
    return this;
  }

  gte(col, val) {
    this._filters.push((row) => row[col] >= val);
    return this;
  }

  lte(col, val) {
    this._filters.push((row) => row[col] <= val);
    return this;
  }

  lt(col, val) {
    this._filters.push((row) => row[col] < val);
    return this;
  }

  gt(col, val) {
    this._filters.push((row) => row[col] > val);
    return this;
  }

  or(filterStr) {
    // Parse simple or filters like "name.ilike.%search%,phone.ilike.%search%"
    const parts = filterStr.split(",");
    const conditions = parts.map((part) => {
      const [col, op, ...valParts] = part.split(".");
      const val = valParts.join(".");
      if (op === "ilike") {
        const search = val.replace(/%/g, "").toLowerCase();
        return (row) => (row[col] || "").toString().toLowerCase().includes(search);
      }
      if (op === "eq") return (row) => row[col] === val;
      return () => true;
    });
    this._filters.push((row) => conditions.some((cond) => cond(row)));
    return this;
  }

  order(col, opts = {}) {
    this._orderCol = col;
    this._orderAsc = opts.ascending !== false;
    return this;
  }

  range(from, to) {
    this._rangeFrom = from;
    this._rangeTo = to;
    return this;
  }

  limit(n) {
    this._limitNum = n;
    return this;
  }

  single() {
    this._singleMode = true;
    return this.then();
  }

  // Make the builder thenable (works with await)
  then(resolve, reject) {
    const result = this._execute();
    const promise = Promise.resolve(result);
    return promise.then(resolve, reject);
  }

  _execute() {
    try {
      if (this._operation === "insert") {
        return this._execInsert();
      }
      if (this._operation === "update") {
        return this._execUpdate();
      }
      if (this._operation === "delete") {
        return this._execDelete();
      }
      return this._execSelect();
    } catch (error) {
      return { data: null, error: { message: error.message }, count: 0 };
    }
  }

  _applyFilters(data) {
    let result = data;
    for (const filter of this._filters) {
      result = result.filter(filter);
    }
    return result;
  }

  _execSelect() {
    let data = this._applyFilters(this._data);
    const count = data.length;

    // Apply ordering
    if (this._orderCol) {
      data.sort((a, b) => {
        const aVal = a[this._orderCol];
        const bVal = b[this._orderCol];
        if (aVal < bVal) return this._orderAsc ? -1 : 1;
        if (aVal > bVal) return this._orderAsc ? 1 : -1;
        return 0;
      });
    }

    // Apply range
    if (this._rangeFrom !== null && this._rangeTo !== null) {
      data = data.slice(this._rangeFrom, this._rangeTo + 1);
    }

    // Apply limit
    if (this._limitNum !== null) {
      data = data.slice(0, this._limitNum);
    }

    // Resolve joins
    if (Object.keys(this._joins).length > 0) {
      data = data.map((row) => resolveJoins(row, this._joins, { customers: "customer_id" }));
    }

    // Head mode returns no data
    if (this._headMode) {
      return { data: null, count, error: null };
    }

    // Single mode
    if (this._singleMode) {
      if (data.length === 0) {
        return { data: null, error: { message: "No rows found" }, count: 0 };
      }
      return { data: data[0], error: null, count };
    }

    return { data, count, error: null };
  }

  _execInsert() {
    const inserted = this._insertData.map((row) => ({
      id: generateId(),
      created_at: new Date().toISOString(),
      ...row,
    }));

    // Add to in-memory table
    tables[this._table] = tables[this._table] || [];
    tables[this._table].push(...clone(inserted));

    // If select() was chained after insert
    if (this._singleMode) {
      return { data: inserted[0], error: null };
    }
    return { data: inserted, error: null };
  }

  _execUpdate() {
    let data = this._applyFilters(tables[this._table] || []);

    // Apply updates in-place
    data.forEach((row) => {
      Object.assign(row, this._updateData);
    });

    // If select() was chained
    if (this._singleMode) {
      return { data: data.length > 0 ? clone(data[0]) : null, error: data.length === 0 ? { message: "No rows found" } : null };
    }
    return { data: clone(data), error: null };
  }

  _execDelete() {
    const before = (tables[this._table] || []).length;
    tables[this._table] = (tables[this._table] || []).filter(
      (row) => !this._filters.every((f) => f(row))
    );
    return { data: null, error: null, count: before - (tables[this._table] || []).length };
  }
}

// Mock auth object
const mockAuth = {
  getUser: async (token) => {
    return {
      data: {
        user: { id: USER_ID, email: "kaushal@aquapure.com" },
      },
      error: null,
    };
  },
  signInWithPassword: async ({ email, password }) => {
    return {
      data: {
        user: { id: USER_ID, email },
        session: {
          access_token: "mock-token-12345",
          refresh_token: "mock-refresh-12345",
        },
      },
      error: null,
    };
  },
  admin: {
    createUser: async ({ email, password }) => {
      return {
        data: { user: { id: generateId(), email } },
        error: null,
      };
    },
  },
};

// The mock Supabase client
const mockSupabaseAdmin = {
  from: (table) => new MockQueryBuilder(table),
  auth: mockAuth,
};

function getMockSupabaseClient(accessToken) {
  return mockSupabaseAdmin;
}

console.log("🔶 Running in MOCK MODE — using static data, no Supabase connection");

module.exports = {
  supabaseAdmin: mockSupabaseAdmin,
  getSupabaseClient: getMockSupabaseClient,
};
