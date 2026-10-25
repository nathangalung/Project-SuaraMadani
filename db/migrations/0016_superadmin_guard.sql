-- INSERT grant is table-wide
CREATE FUNCTION "users_superadmin_guard"() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NEW.superadmin
    AND current_user <> 'sb_migrator'
    AND NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'superadmin is set from the CLI only' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER "users_superadmin_guard" BEFORE INSERT OR UPDATE OF "superadmin" ON "users"
  FOR EACH ROW EXECUTE FUNCTION "users_superadmin_guard"();
