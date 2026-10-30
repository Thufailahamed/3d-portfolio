/** Projects whose detail page is a full product landing page, drawing its own chrome. */
export const LANDING_SLUGS = ["legal-workspace", "vyro", "school-system", "healthhub"] as const;
export const isLanding = (pathname: string) => LANDING_SLUGS.some((s) => pathname === `/projects/${s}`);
