/**
 * City normalisation and India state/tier mapping.
 *
 * The LenDenClub export stores a free-text "city" field that frequently
 * contains a district, a suburb or a state name (e.g. "East Godavari",
 * "Bangalore North", "India"). We normalise the common spellings, then map
 * the largest ~200 places to a state and a rough tier so that geographic
 * charts are meaningful. Everything outside the map is kept as-is and marked
 * "Other" / tier 3 rather than being silently dropped.
 */

const EXACT = {
  // Metro / tier-1 aliases
  bangalore: ['Bengaluru', 'Karnataka', 1],
  bengaluru: ['Bengaluru', 'Karnataka', 1],
  'bangalore north': ['Bengaluru', 'Karnataka', 1],
  'bangalore south': ['Bengaluru', 'Karnataka', 1],
  'bangalore east': ['Bengaluru', 'Karnataka', 1],
  'bangalore rural': ['Bengaluru', 'Karnataka', 1],
  'bengaluru urban': ['Bengaluru', 'Karnataka', 1],
  mumbai: ['Mumbai', 'Maharashtra', 1],
  'mumbai suburban': ['Mumbai', 'Maharashtra', 1],
  'mumbai city': ['Mumbai', 'Maharashtra', 1],
  thane: ['Thane', 'Maharashtra', 1],
  'navi mumbai': ['Navi Mumbai', 'Maharashtra', 1],
  pune: ['Pune', 'Maharashtra', 1],
  'pune city': ['Pune', 'Maharashtra', 1],
  hyderabad: ['Hyderabad', 'Telangana', 1],
  secunderabad: ['Hyderabad', 'Telangana', 1],
  chennai: ['Chennai', 'Tamil Nadu', 1],
  kolkata: ['Kolkata', 'West Bengal', 1],
  delhi: ['Delhi', 'Delhi', 1],
  'new delhi': ['Delhi', 'Delhi', 1],
  'south delhi': ['Delhi', 'Delhi', 1],
  'north delhi': ['Delhi', 'Delhi', 1],
  'west delhi': ['Delhi', 'Delhi', 1],
  'east delhi': ['Delhi', 'Delhi', 1],
  'north west delhi': ['Delhi', 'Delhi', 1],
  'south west delhi': ['Delhi', 'Delhi', 1],
  'central delhi': ['Delhi', 'Delhi', 1],
  ahmedabad: ['Ahmedabad', 'Gujarat', 1],
  'ahmedabad city': ['Ahmedabad', 'Gujarat', 1],
  surat: ['Surat', 'Gujarat', 1],
  'surat city': ['Surat', 'Gujarat', 1],
  vadodara: ['Vadodara', 'Gujarat', 2],
  rajkoT: ['Rajkot', 'Gujarat', 2],
  rajkot: ['Rajkot', 'Gujarat', 2],
  jaipur: ['Jaipur', 'Rajasthan', 1],
  lucknow: ['Lucknow', 'Uttar Pradesh', 2],
  noida: ['Noida', 'Uttar Pradesh', 1],
  ghaziabad: ['Ghaziabad', 'Uttar Pradesh', 1],
  gurgaon: ['Gurugram', 'Haryana', 1],
  gurugram: ['Gurugram', 'Haryana', 1],
  faridabad: ['Faridabad', 'Haryana', 1],
  indore: ['Indore', 'Madhya Pradesh', 2],
  bhopal: ['Bhopal', 'Madhya Pradesh', 2],
  nagpur: ['Nagpur', 'Maharashtra', 2],
  nashik: ['Nashik', 'Maharashtra', 2],
  aurangabad: ['Aurangabad', 'Maharashtra', 3],
  patna: ['Patna', 'Bihar', 2],
  raipur: ['Raipur', 'Chhattisgarh', 2],
  ranchi: ['Ranchi', 'Jharkhand', 3],
  bhubaneswar: ['Bhubaneswar', 'Odisha', 2],
  visakhapatnam: ['Visakhapatnam', 'Andhra Pradesh', 2],
  vijayawada: ['Vijayawada', 'Andhra Pradesh', 2],
  'vijayawada (urban)': ['Vijayawada', 'Andhra Pradesh', 2],
  guntur: ['Guntur', 'Andhra Pradesh', 3],
  nellore: ['Nellore', 'Andhra Pradesh', 3],
  tirupati: ['Tirupati', 'Andhra Pradesh', 3],
  kurnool: ['Kurnool', 'Andhra Pradesh', 3],
  coimbatore: ['Coimbatore', 'Tamil Nadu', 2],
  'coimbatore south': ['Coimbatore', 'Tamil Nadu', 2],
  madurai: ['Madurai', 'Tamil Nadu', 3],
  salem: ['Salem', 'Tamil Nadu', 3],
  tiruchirappalli: ['Tiruchirappalli', 'Tamil Nadu', 3],
  tiruppur: ['Tiruppur', 'Tamil Nadu', 3],
  vellore: ['Vellore', 'Tamil Nadu', 3],
  erode: ['Erode', 'Tamil Nadu', 3],
  thiruvananthapuram: ['Thiruvananthapuram', 'Kerala', 2],
  kochi: ['Kochi', 'Kerala', 2],
  ernakulam: ['Kochi', 'Kerala', 2],
  kozhikode: ['Kozhikode', 'Kerala', 3],
  kollam: ['Kollam', 'Kerala', 3],
  thrissur: ['Thrissur', 'Kerala', 3],
  mysore: ['Mysuru', 'Karnataka', 2],
  mysuru: ['Mysuru', 'Karnataka', 2],
  mangalore: ['Mangaluru', 'Karnataka', 3],
  'dakshina kannada': ['Mangaluru', 'Karnataka', 3],
  hubli: ['Hubballi', 'Karnataka', 3],
  belgaum: ['Belagavi', 'Karnataka', 3],
  gulbarga: ['Kalaburagi', 'Karnataka', 3],
  davangere: ['Davangere', 'Karnataka', 3],
  shivamogga: ['Shivamogga', 'Karnataka', 3],
  tumkur: ['Tumakuru', 'Karnataka', 3],
  dehardun: ['Dehradun', 'Uttarakhand', 3],
  dehradun: ['Dehradun', 'Uttarakhand', 3],
  jammu: ['Jammu', 'Jammu & Kashmir', 3],
  ludhiana: ['Ludhiana', 'Punjab', 2],
  amritsar: ['Amritsar', 'Punjab', 2],
  jalandhar: ['Jalandhar', 'Punjab', 3],
  chandigarh: ['Chandigarh', 'Chandigarh', 2],
  jodhpur: ['Jodhpur', 'Rajasthan', 2],
  udaipur: ['Udaipur', 'Rajasthan', 3],
  kota: ['Kota', 'Rajasthan', 3],
  ajmer: ['Ajmer', 'Rajasthan', 3],
  alwar: ['Alwar', 'Rajasthan', 3],
  bhilwara: ['Bhilwara', 'Rajasthan', 3],
  agra: ['Agra', 'Uttar Pradesh', 2],
  aligarh: ['Aligarh', 'Uttar Pradesh', 3],
  bareilly: ['Bareilly', 'Uttar Pradesh', 3],
  gorakhpur: ['Gorakhpur', 'Uttar Pradesh', 3],
  saharanpur: ['Saharanpur', 'Uttar Pradesh', 3],
  bulandshahr: ['Bulandshahr', 'Uttar Pradesh', 3],
  varanasi: ['Varanasi', 'Uttar Pradesh', 2],
  kanpur: ['Kanpur', 'Uttar Pradesh', 2],
  allahabad: ['Prayagraj', 'Uttar Pradesh', 3],
  prayagraj: ['Prayagraj', 'Uttar Pradesh', 3],
  meerut: ['Meerut', 'Uttar Pradesh', 3],
  moradabad: ['Moradabad', 'Uttar Pradesh', 3],
  gwalior: ['Gwalior', 'Madhya Pradesh', 3],
  jabalpur: ['Jabalpur', 'Madhya Pradesh', 3],
  ujjain: ['Ujjain', 'Madhya Pradesh', 3],
  nashik: ['Nashik', 'Maharashtra', 2],
  solapur: ['Solapur', 'Maharashtra', 3],
  amravati: ['Amravati', 'Maharashtra', 3],
  latur: ['Latur', 'Maharashtra', 3],
  satara: ['Satara', 'Maharashtra', 3],
  kolhapur: ['Kolhapur', 'Maharashtra', 3],
  sangli: ['Sangli', 'Maharashtra', 3],
  ahmednagar: ['Ahmednagar', 'Maharashtra', 3],
  kalyan: ['Kalyan', 'Maharashtra', 2],
  palghar: ['Palghar', 'Maharashtra', 3],
  raigarh: ['Raigad', 'Maharashtra', 3],
  raigad: ['Raigad', 'Maharashtra', 3],
  cuttack: ['Cuttack', 'Odisha', 3],
  ganjam: ['Ganjam', 'Odisha', 3],
  warangal: ['Warangal', 'Telangana', 3],
  karimnagar: ['Karimnagar', 'Telangana', 3],
  nizamabad: ['Nizamabad', 'Telangana', 3],
  khammam: ['Khammam', 'Telangana', 3],
  nalgonda: ['Nalgonda', 'Telangana', 3],
  'mahabub nagar': ['Mahbubnagar', 'Telangana', 3],
  'k.v. rangareddy': ['Rangareddy', 'Telangana', 3],
  rangareddy: ['Rangareddy', 'Telangana', 3],
  chittoor: ['Chittoor', 'Andhra Pradesh', 3],
  kadapa: ['Kadapa', 'Andhra Pradesh', 3],
  cuddapah: ['Kadapa', 'Andhra Pradesh', 3],
  anantapur: ['Anantapur', 'Andhra Pradesh', 3],
  srikakulam: ['Srikakulam', 'Andhra Pradesh', 3],
  vizianagaram: ['Vizianagaram', 'Andhra Pradesh', 3],
  'east godavari': ['Rajahmundry', 'Andhra Pradesh', 3],
  'west godavari': ['Eluru', 'Andhra Pradesh', 3],
  krishna: ['Vijayawada', 'Andhra Pradesh', 3],
  prakasam: ['Ongole', 'Andhra Pradesh', 3],
  nellore: ['Nellore', 'Andhra Pradesh', 3],
  tiruvallur: ['Tiruvallur', 'Tamil Nadu', 3],
  kanchipuram: ['Kanchipuram', 'Tamil Nadu', 3],
  kancheepuram: ['Kanchipuram', 'Tamil Nadu', 3],
  dharmapuri: ['Dharmapuri', 'Tamil Nadu', 3],
  cuddalore: ['Cuddalore', 'Tamil Nadu', 3],
  villupuram: ['Villupuram', 'Tamil Nadu', 3],
  tirunelveli: ['Tirunelveli', 'Tamil Nadu', 3],
  tiruvannamalai: ['Tiruvannamalai', 'Tamil Nadu', 3],
  pudukkottai: ['Pudukkottai', 'Tamil Nadu', 3],
  'north 24 parganas': ['North 24 Parganas', 'West Bengal', 3],
  'south 24 parganas': ['South 24 Parganas', 'West Bengal', 3],
  howrah: ['Howrah', 'West Bengal', 2],
  hooghly: ['Hooghly', 'West Bengal', 3],
  durgapur: ['Durgapur', 'West Bengal', 3],
  siliguri: ['Siliguri', 'West Bengal', 3],
  asansol: ['Asansol', 'West Bengal', 3],
  // State names accidentally used as cities
  'tamil nadu': ['Tamil Nadu (state)', 'Tamil Nadu', 3],
  karnataka: ['Karnataka (state)', 'Karnataka', 3],
  maharashtra: ['Maharashtra (state)', 'Maharashtra', 3],
  'uttar pradesh': ['Uttar Pradesh (state)', 'Uttar Pradesh', 3],
  rajasthan: ['Rajasthan (state)', 'Rajasthan', 3],
  gujarat: ['Gujarat (state)', 'Gujarat', 3],
  telangana: ['Telangana (state)', 'Telangana', 3],
  'andhra pradesh': ['Andhra Pradesh (state)', 'Andhra Pradesh', 3],
  kerala: ['Kerala (state)', 'Kerala', 3],
  'madhya pradesh': ['Madhya Pradesh (state)', 'Madhya Pradesh', 3],
  haryana: ['Haryana (state)', 'Haryana', 3],
  punjab: ['Punjab (state)', 'Punjab', 3],
  odisha: ['Odisha (state)', 'Odisha', 3],
  bihar: ['Bihar (state)', 'Bihar', 3],
  jharkhand: ['Jharkhand (state)', 'Jharkhand', 3],
  chhattisgarh: ['Chhattisgarh (state)', 'Chhattisgarh', 3],
  assam: ['Assam (state)', 'Assam', 3],
  'west bengal': ['West Bengal (state)', 'West Bengal', 3],
  uttarakhand: ['Uttarakhand (state)', 'Uttarakhand', 3],
  goa: ['Goa (state)', 'Goa', 3],
};

export function normaliseCity(raw) {
  const value = String(raw || '').trim();
  if (!value) return { city: 'Unknown', state: 'Unknown', tier: 0 };
  if (/^india$/i.test(value)) return { city: 'Unknown', state: 'Unknown', tier: 0 };

  const key = value
    .toLowerCase()
    .replace(/[.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (EXACT[key]) {
    const [city, state, tier] = EXACT[key];
    return { city, state, tier };
  }

  // Handle "City (Urban)", "City City", district suffixes.
  const stripped = key
    .replace(/\s*\(.*?\)\s*/g, '')
    .replace(/\s+city$/, '')
    .replace(/\s+urban$/, '')
    .replace(/\s+rural$/, '')
    .trim();

  if (EXACT[stripped]) {
    const [city, state, tier] = EXACT[stripped];
    return { city, state, tier };
  }

  // A few generic patterns for places not in the curated map.
  const title = value
    .replace(/\s*\(.*?\)\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (m) => m.toUpperCase());

  const stateBySuffix = [
    [/nagar|nagaram|puram|palli|palle|palle|palli/i, 'Other', 3],
  ];
  void stateBySuffix;

  return { city: title, state: 'Other', tier: 3 };
}

export const CITY_TIER_LABEL = {
  0: 'Unknown',
  1: 'Tier 1 metro',
  2: 'Tier 2 city',
  3: 'Tier 3 / other',
};
