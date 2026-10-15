/** PEP 503 normalisation: lowercase, runs of `-`, `_` and `.` become a single `-`. */
export function normalizePythonName(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, "-");
}

/** Distribution name (normalised) to the top-level module names it installs, where they differ. */
const IMPORT_ALIASES: Record<string, string[]> = {
  attrs: ["attr", "attrs"],
  beautifulsoup4: ["bs4"],
  beautifulsoup: ["BeautifulSoup"],
  "django-cors-headers": ["corsheaders"],
  djangorestframework: ["rest_framework"],
  "google-cloud-storage": ["google.cloud.storage"],
  "google-cloud-bigquery": ["google.cloud.bigquery"],
  grpcio: ["grpc"],
  "msgpack-python": ["msgpack"],
  mysqlclient: ["MySQLdb"],
  "opencv-python": ["cv2"],
  "opencv-python-headless": ["cv2"],
  "opencv-contrib-python": ["cv2"],
  pillow: ["PIL"],
  protobuf: ["google.protobuf"],
  "psycopg2-binary": ["psycopg2"],
  pycryptodome: ["Crypto"],
  pycryptodomex: ["Cryptodome"],
  pyjwt: ["jwt"],
  pymongo: ["pymongo", "bson", "gridfs"],
  pyopenssl: ["OpenSSL"],
  pyserial: ["serial"],
  pytz: ["pytz"],
  pyyaml: ["yaml"],
  pyzmq: ["zmq"],
  "python-dateutil": ["dateutil"],
  "python-dotenv": ["dotenv"],
  "python-jose": ["jose"],
  "python-magic": ["magic"],
  "python-multipart": ["multipart"],
  "python-slugify": ["slugify"],
  pywin32: ["win32api", "win32con", "win32com"],
  "ruamel-yaml": ["ruamel.yaml"],
  "scikit-image": ["skimage"],
  "scikit-learn": ["sklearn"],
  setuptools: ["setuptools", "pkg_resources"],
  "tensorflow-cpu": ["tensorflow"],
  "typing-extensions": ["typing_extensions"],
};

/**
 * Candidate import names for a distribution. The alias table covers the well-known mismatches; the heuristic
 * covers the common `name-with-dashes` → `name_with_dashes` and `python-` prefix/suffix patterns. The Planner
 * also sees the modules actually imported in the repository and confirms the mapping.
 */
export function importNames(dist: string): string[] {
  const norm = normalizePythonName(dist);
  const out = new Set<string>(IMPORT_ALIASES[norm] ?? []);
  const underscored = norm.replace(/-/g, "_");
  out.add(underscored);
  const stripped = norm.replace(/^(python|py)-/, "").replace(/-(python|py)$/, "");
  if (stripped && stripped !== norm) out.add(stripped.replace(/-/g, "_"));
  return [...out];
}
