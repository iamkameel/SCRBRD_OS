// ── MOCK DATA ────────────────────────────────────────────
const SCHOOL = {
  name:"Hilton College", abbr:"HIL", city:"Hilton, KwaZulu-Natal",
  founded:1872, colors:["#003366","#C8A951"],
  address:"1 College Rd, Hilton, 3245",
  province:"KwaZulu-Natal",
  region:"Midlands",
  altitude:"1080m above sea level",
  climate:"Subtropical highland — thunderstorms common Oct–Mar",
};

const KZN_SCHOOLS = [
  { abbr:"MIC", name:"Michaelhouse",           city:"Balgowan",        region:"Midlands", colors:["#8B0000","#FFD700"] },
  { abbr:"MCB", name:"Maritzburg College",      city:"Pietermaritzburg",region:"Midlands", colors:["#003366","#FFFFFF"] },
  { abbr:"DHS", name:"Durban High School",      city:"Durban",          region:"Coastal",  colors:["#006400","#FFD700"] },
  { abbr:"KEA", name:"Kearsney College",        city:"Botha's Hill",    region:"Midlands", colors:["#003087","#FFFFFF"] },
  { abbr:"GLE", name:"Glenwood High School",    city:"Durban",          region:"Coastal",  colors:["#00008B","#FFFFFF"] },
  { abbr:"WES", name:"Westville Boys' High",    city:"Westville",       region:"Coastal",  colors:["#800000","#C0C0C0"] },
  { abbr:"CLF", name:"Clifton School",          city:"Durban",          region:"Coastal",  colors:["#006400","#FFFFFF"] },
  { abbr:"NSC", name:"Northlands Boys High",    city:"Durban",          region:"Coastal",  colors:["#00008B","#FFD700"] },
  { abbr:"SPB", name:"St Henry's Marist",       city:"Durban",          region:"Coastal",  colors:["#8B0000","#FFFFFF"] },
  { abbr:"PMS", name:"Pinetown Boys' High",     city:"Pinetown",        region:"Coastal",  colors:["#006400","#FFFFFF"] },
  { abbr:"RCB", name:"Richard Gush College",    city:"Howick",          region:"Midlands", colors:["#003366","#FFFFFF"] },
];

// ── SCHOOLS REGISTRY (pre-listed for onboarding) ─────
const SCHOOLS_REGISTRY = [
  // KZN Midlands
  { id:"HIL", name:"Hilton College",            city:"Hilton",           province:"KZN", region:"Midlands", type:"Independent" },
  { id:"MIC", name:"Michaelhouse",              city:"Balgowan",         province:"KZN", region:"Midlands", type:"Independent" },
  { id:"MCB", name:"Maritzburg College",        city:"Pietermaritzburg", province:"KZN", region:"Midlands", type:"Government"  },
  { id:"KEA", name:"Kearsney College",          city:"Botha's Hill",     province:"KZN", region:"Midlands", type:"Independent" },
  { id:"RCB", name:"Richard Gush College",      city:"Howick",           province:"KZN", region:"Midlands", type:"Independent" },
  { id:"PMR", name:"St Charles College",        city:"Pietermaritzburg", province:"KZN", region:"Midlands", type:"Independent" },
  // KZN Coastal
  { id:"DHS", name:"Durban High School",        city:"Durban",           province:"KZN", region:"Coastal",  type:"Government"  },
  { id:"GLE", name:"Glenwood High School",      city:"Durban",           province:"KZN", region:"Coastal",  type:"Government"  },
  { id:"WES", name:"Westville Boys' High",      city:"Westville",        province:"KZN", region:"Coastal",  type:"Government"  },
  { id:"CLF", name:"Clifton School",            city:"Durban",           province:"KZN", region:"Coastal",  type:"Independent" },
  { id:"NSC", name:"Northlands Boys High",      city:"Durban",           province:"KZN", region:"Coastal",  type:"Government"  },
  { id:"SPB", name:"St Henry's Marist",         city:"Durban",           province:"KZN", region:"Coastal",  type:"Independent" },
  { id:"PMS", name:"Pinetown Boys' High",       city:"Pinetown",         province:"KZN", region:"Coastal",  type:"Government"  },
  { id:"CBC", name:"Christian Brothers College",city:"Durban",           province:"KZN", region:"Coastal",  type:"Independent" },
  // Gauteng
  { id:"SAC", name:"St Alban's College",        city:"Pretoria",         province:"GP",  region:"North",    type:"Independent" },
  { id:"AFF", name:"Affies",                    city:"Pretoria",         province:"GP",  region:"North",    type:"Government"  },
  { id:"KES", name:"King Edward VII School",    city:"Johannesburg",     province:"GP",  region:"Central",  type:"Government"  },
  { id:"SJC", name:"St John's College",         city:"Johannesburg",     province:"GP",  region:"Central",  type:"Independent" },
  { id:"SAJ", name:"St Andrew's School Jozi",   city:"Johannesburg",     province:"GP",  region:"Central",  type:"Independent" },
  { id:"PRE", name:"Pretoria Boys High",        city:"Pretoria",         province:"GP",  region:"North",    type:"Government"  },
  // Western Cape
  { id:"SAG", name:"SACS (South African College Schools)", city:"Cape Town", province:"WC", region:"Metro",  type:"Government"  },
  { id:"BOL", name:"Boland Landbou",            city:"Paarl",            province:"WC",  region:"Boland",   type:"Government"  },
  { id:"PAA", name:"Paarl Boys' High",          city:"Paarl",            province:"WC",  region:"Boland",   type:"Government"  },
  { id:"STB", name:"Stellenbosch Gimnasium",    city:"Stellenbosch",     province:"WC",  region:"Boland",   type:"Government"  },
  { id:"DIO", name:"Diocesan College (Bishops)",city:"Rondebosch",       province:"WC",  region:"Metro",    type:"Independent" },
  { id:"RCC", name:"Rondebosch Boys' High",     city:"Rondebosch",       province:"WC",  region:"Metro",    type:"Government"  },
  // Eastern Cape
  { id:"SAR", name:"St Andrew's College",       city:"Grahamstown",      province:"EC",  region:"Eastern",  type:"Independent" },
  { id:"KWT", name:"Kingswood College",         city:"Grahamstown",      province:"EC",  region:"Eastern",  type:"Independent" },
  { id:"GRY", name:"Grey High School",          city:"Port Elizabeth",   province:"EC",  region:"Eastern",  type:"Government"  },
  { id:"PEH", name:"Hudson Park High School",   city:"East London",      province:"EC",  region:"Eastern",  type:"Government"  },
  // Other
  { id:"OTH", name:"Other / Not Listed",        city:"",                 province:"",    region:"",         type:"Other"       },
];

export { KZN_SCHOOLS, SCHOOL, SCHOOLS_REGISTRY };
