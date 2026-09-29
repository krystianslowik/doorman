// Wrangler bundles data/*.txt as text modules (its default rules), imported by src/worker.ts.
declare module "*.txt" {
  const text: string;
  export default text;
}
