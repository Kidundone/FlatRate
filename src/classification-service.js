const SUPABASE_URL = "https://lfnydhidbwfyfjafazdy.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxmbnlkaGlkYndmeWZqYWZhemR5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgzNTk0MDYsImV4cCI6MjA4MzkzNTQwNn0.ES4tEeUgtTrPjYR64SGHDeQJps7dFdTmF7IRUhPZwt4";
const STOCK_PREFIX_RULES = [];

function getStockPrefixRules() {
  if (Array.isArray(window.STOCK_PREFIX_RULES)) return window.STOCK_PREFIX_RULES;
  if (typeof STOCK_PREFIX_RULES !== "undefined" && Array.isArray(STOCK_PREFIX_RULES)) return STOCK_PREFIX_RULES;
  return [];
}

function unmappedClassification() {
  return {
    brand: "Unmapped",
    store: null,
    campus: null,
    matched_on: null,
  };
}

async function lookupPatternMappings(patterns) {
  for (const p of (patterns || [])) {
    const { data } = await sb()
      .from("pattern_mappings")
      .select("*")
      .eq("pattern_type", p.type)
      .eq("pattern_value", p.value)
      .maybeSingle();

    if (data) {
      return {
        brand: data.brand,
        store: data.store,
        campus: data.campus,
        matched_on: p.matched_on || `${p.type}:${p.value}`,
      };
    }
  }

  return null;
}

function extractStructuredPatterns({ ro, stock, vin }) {
  const patterns = [];

  if (vin && String(vin).length >= 3) {
    patterns.push({
      type: "VIN",
      value: String(vin).slice(0, 3).toUpperCase(),
    });
  }

  if (stock) {
    const prefix = String(stock).replace(/[^A-Z]/gi, "").slice(0, 3).toUpperCase();
    if (prefix) {
      patterns.push({
        type: "STK",
        value: prefix,
      });
    }
  }

  if (ro) {
    const prefix = String(ro).replace(/[^A-Z]/gi, "").slice(0, 1).toUpperCase();
    if (prefix) {
      patterns.push({
        type: "RO",
        value: prefix,
      });
    }
  }

  return patterns;
}

async function classifyEntryUniversal({ ro, stock, vin }) {
  const patterns = extractStructuredPatterns({ ro, stock, vin });
  const classification = await lookupPatternMappings(patterns);
  return classification || unmappedClassification();
}

async function classifyEntryWithFallback({ ro, stock, vin }) {
  return classifyEntryUniversal({ ro, stock, vin });
}

async function classifyDealerUniversal({ ro, stock, vin }) {
  const classification = await classifyEntryWithFallback({ ro, stock, vin });
  if (!classification || classification.brand === "Unmapped") return "Unknown";
  return classification.brand;
}

const GENERIC_PREFIX_BRAND = Object.freeze({
  A: "Acura",
  B: "Audi",
  C: "Chevrolet",
  F: "Ford",
  H: "Honda",
  K: "Kia",
  L: "Lexus",
  M: "Mazda",
  N: "Nissan",
  S: "Subaru",
  T: "Toyota",
  V: "Volkswagen",
});

const SPECIAL_PREFIX_RULES = Object.freeze([
  { prefix: "SL", type: "Service Loaner" },
  { prefix: "XS", type: "Dealer Trade - New" },
  { prefix: "DT", type: "Dealer Trade" },
  { prefix: "P", type: "Curb Purchase" },
]);

let USER_PREFIX_RULES = [];

async function loadUserPrefixRules() {
  const { data, error } = await sb()
    .from("dealer_prefix_rules")
    .select("*");

  if (error) {
    console.error("Failed loading rules", error);
    return;
  }

  USER_PREFIX_RULES = (data || []).sort((a, b) => b.prefix.length - a.prefix.length);
}

function normalizeStock(stock) {
  if (!stock) return null;

  const clean = stock.toUpperCase().replace(/[^A-Z0-9]/g, "");

  // Handle reused stock ending in A
  if (clean.length > 2 && clean.endsWith("A")) {
    return clean.slice(0, -1);
  }

  return clean;
}

function classifyStock(stock, rules) {
  if (!stock) return null;

  const normalized = normalizeStock(stock);
  if (!normalized) return null;

  for (const rule of (rules || [])) {
    if (normalized.startsWith(rule.prefix.toUpperCase())) {
      return {
        brand: rule.brand || "Unknown",
        vehicle_type: rule.vehicle_type || "Unknown",
        prefix: rule.prefix
      };
    }
  }

  return null;
}

const BRAND_KEYWORDS = Object.freeze([
  { match: ["VOLKSWAGEN", "VW"], brand: "Volkswagen" },
  { match: ["AUDI"], brand: "Audi" },
  { match: ["SUBARU"], brand: "Subaru" },
  { match: ["ACURA"], brand: "Acura" },
  { match: ["HONDA"], brand: "Honda" },
  { match: ["TOYOTA"], brand: "Toyota" },
  { match: ["FORD"], brand: "Ford" },
  { match: ["CHEVROLET", "CHEVY"], brand: "Chevrolet" },
  { match: ["NISSAN"], brand: "Nissan" },
  { match: ["BMW"], brand: "BMW" },
  { match: ["JEEP"], brand: "Jeep" },
  { match: ["RAM"], brand: "Ram" },
  { match: ["KIA"], brand: "Kia" },
  { match: ["HYUNDAI"], brand: "Hyundai" },
  { match: ["LEXUS"], brand: "Lexus" },
  { match: ["MAZDA"], brand: "Mazda" },
  { match: ["GMC"], brand: "GMC" },
]);

function detectBrandFromText(text) {
  if (!text) return null;

  const upper = String(text).toUpperCase();

  for (const rule of BRAND_KEYWORDS) {
    for (const keyword of rule.match) {
      if (upper.includes(keyword)) {
        return rule.brand;
      }
    }
  }

  return null;
}

function detectFromStock(stockNumber) {
  if (!stockNumber) return null;

  const clean = normalizeStock(stockNumber);
  if (!clean) return null;
  const rules = (USER_PREFIX_RULES.length ? USER_PREFIX_RULES : getStockPrefixRules())
    .slice()
    .sort((a, b) => b.prefix.length - a.prefix.length);

  for (const rule of rules) {
    const prefix = String(rule.prefix || "").toUpperCase();
    if (prefix && clean.startsWith(prefix)) {
      const brand = rule.brand !== "Unknown" ? rule.brand : null;
      const type = rule.type || rule.vehicle_type || "Unknown";
      return { brand, type };
    }
  }

  for (const rule of SPECIAL_PREFIX_RULES) {
    const prefix = String(rule.prefix || "").toUpperCase();
    if (!prefix) continue;
    if (clean.startsWith(prefix) || clean.slice(1).startsWith(prefix)) {
      const firstChar = clean.charAt(0);
      const genericBrand = GENERIC_PREFIX_BRAND[firstChar] || null;
      return { brand: genericBrand, type: rule.type || "Unknown" };
    }
  }

  const firstChar = clean.charAt(0);
  const genericBrand = GENERIC_PREFIX_BRAND[firstChar] || null;
  if (genericBrand) {
    return { brand: genericBrand, type: "Unknown" };
  }

  return null;
}

function detectBrand({ ro = "", stock = "" }) {
  const stockHit = detectFromStock(stock || ro);
  if (stockHit?.brand) return stockHit.brand;
  return "Unknown";
}

async function resolveDealerForLog(log) {
  const classification = await classifyEntryWithFallback({
    ro: log?.ro_number || log?.ref || log?.ro || "",
    stock: log?.stock_number || log?.stock || "",
    vin: log?.vin || log?.vin8 || "",
  });

  if (classification.brand !== "Unmapped") return classification.brand;
  return "UNKNOWN";
}

async function backfillDealersFromPhotos(logs) {
  let sourceLogs = Array.isArray(logs) ? logs : null;
  if (!sourceLogs) {
    const empId = getEmpId();
    if (!empId) throw new Error("Employee # required");
    sourceLogs = await apiListLogs(empId);
  }

  const targetLogs = sourceLogs.filter(
    (log) => log?.id && (!log.dealer || String(log.dealer).toUpperCase() === "UNKNOWN")
  );
  let updated = 0;

  for (const log of targetLogs) {
    try {
      const dealer = await resolveDealerForLog(log);

      await updateWorkLogWithFallback(sb(), log.id, {
        dealer,
        updated_at: new Date().toISOString(),
      });

      updated += 1;
    } catch (e) {
      console.error("Failed:", log.id, e);
    }

    await new Promise(r => setTimeout(r, 200));
  }

  await safeLoadEntries();
  return { total: targetLogs.length, updated };
}

window.__FR = window.__FR || {};
window.__FR.backfillDealersFromPhotos = backfillDealersFromPhotos;
window.__FR.resolveDealerForLog = resolveDealerForLog;
window.__FR.loadUserPrefixRules = loadUserPrefixRules;
