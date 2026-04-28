DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "users"
    GROUP BY lower("username")
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot create users_username_lower_unique while case-insensitive username duplicates exist';
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_username_lower_unique" ON "users" (lower("username"));
