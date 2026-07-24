import { migrate } from "drizzle-orm/postgres-js/migrator";
import { eq } from "drizzle-orm";
import { auth } from "../src/lib/auth.js";
import { db, client } from "../src/lib/db.js";
import { adminRole, user } from "../src/db/schema.js";

await migrate(db, { migrationsFolder: new URL("../drizzle", import.meta.url).pathname });

const email = process.env.BOOTSTRAP_ADMIN_EMAIL;
const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
if (!email || !password) throw new Error("BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD are required");

let [admin] = await db.select().from(user).where(eq(user.email, email));
if (!admin) {
  await auth.api.signUpEmail({ body: { name: process.env.BOOTSTRAP_ADMIN_NAME ?? "Admin", email, password } });
  [admin] = await db.select().from(user).where(eq(user.email, email));
}
if (!admin) throw new Error("Unable to bootstrap dashboard administrator");
await db.insert(adminRole).values({ userId: admin.id }).onConflictDoNothing();
await client.end();
