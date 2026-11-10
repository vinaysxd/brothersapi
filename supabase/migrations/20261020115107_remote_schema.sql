


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (
    NEW.id, 
    NEW.email, 
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_app_meta_data->>'role', 'staff')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rls_auto_enable"() RETURNS "event_trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."rls_auto_enable"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."attendance" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "staff_id" "uuid",
    "site_id" "uuid",
    "clock_in" timestamp with time zone DEFAULT "now"(),
    "clock_out" timestamp with time zone,
    "clock_in_lat" numeric NOT NULL,
    "clock_in_lng" numeric NOT NULL,
    "clock_out_lat" numeric,
    "clock_out_lng" numeric
);


ALTER TABLE "public"."attendance" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."attendance_photos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "attendance_id" "uuid",
    "before_photo_url" "text",
    "after_photo_url" "text",
    "label" "text"
);


ALTER TABLE "public"."attendance_photos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."client_profile" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "profile_id" "uuid",
    "company_name" "text",
    "billing_address" "text",
    "contact_person" "text",
    "is_active" boolean DEFAULT true,
    "qb_customer_id" "text"
);


ALTER TABLE "public"."client_profile" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "full_name" "text" NOT NULL,
    "phone" "text",
    "role" "text" NOT NULL,
    "avatar_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "is_active" boolean DEFAULT true,
    CONSTRAINT "profiles_role_check" CHECK (("role" = ANY (ARRAY['admin'::"text", 'staff'::"text", 'client'::"text"])))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."quickbooks_config" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "access_token" "text" NOT NULL,
    "refresh_token" "text" NOT NULL,
    "realm_id" "text" NOT NULL,
    "token_expiry" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "singleton" boolean DEFAULT true
);


ALTER TABLE "public"."quickbooks_config" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."site_notes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "site_id" "uuid",
    "note" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "type" "text" DEFAULT 'staff'::"text" NOT NULL,
    "author_id" "uuid",
    CONSTRAINT "site_notes_type_check" CHECK (("type" = ANY (ARRAY['staff'::"text", 'client'::"text"])))
);


ALTER TABLE "public"."site_notes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."site_staff" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "site_id" "uuid",
    "profile_id" "uuid"
);


ALTER TABLE "public"."site_staff" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."site_tasks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "site_id" "uuid",
    "label" "text" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."site_tasks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sites" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid",
    "name" "text" NOT NULL,
    "address" "text" NOT NULL,
    "latitude" numeric NOT NULL,
    "longitude" numeric NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "is_active" boolean DEFAULT true
);


ALTER TABLE "public"."sites" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."staff_profile" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "profile_id" "uuid",
    "employee_id" "text",
    "address" "text",
    "emergency_contact" "text",
    "joined_date" "date" DEFAULT CURRENT_DATE,
    "is_active" boolean DEFAULT true
);


ALTER TABLE "public"."staff_profile" OWNER TO "postgres";


ALTER TABLE ONLY "public"."attendance_photos"
    ADD CONSTRAINT "attendance_photos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."attendance"
    ADD CONSTRAINT "attendance_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_profile"
    ADD CONSTRAINT "client_profile_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_profile"
    ADD CONSTRAINT "client_profile_profile_id_key" UNIQUE ("profile_id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."quickbooks_config"
    ADD CONSTRAINT "quickbooks_config_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."quickbooks_config"
    ADD CONSTRAINT "quickbooks_config_singleton_key" UNIQUE ("singleton");



ALTER TABLE ONLY "public"."site_notes"
    ADD CONSTRAINT "site_notes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."site_staff"
    ADD CONSTRAINT "site_staff_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."site_staff"
    ADD CONSTRAINT "site_staff_site_id_profile_id_key" UNIQUE ("site_id", "profile_id");



ALTER TABLE ONLY "public"."site_tasks"
    ADD CONSTRAINT "site_tasks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."site_tasks"
    ADD CONSTRAINT "site_tasks_site_id_label_key" UNIQUE ("site_id", "label");



ALTER TABLE ONLY "public"."sites"
    ADD CONSTRAINT "sites_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."staff_profile"
    ADD CONSTRAINT "staff_profile_employee_id_key" UNIQUE ("employee_id");



ALTER TABLE ONLY "public"."staff_profile"
    ADD CONSTRAINT "staff_profile_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."staff_profile"
    ADD CONSTRAINT "staff_profile_profile_id_key" UNIQUE ("profile_id");



ALTER TABLE ONLY "public"."attendance_photos"
    ADD CONSTRAINT "attendance_photos_attendance_id_fkey" FOREIGN KEY ("attendance_id") REFERENCES "public"."attendance"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."attendance"
    ADD CONSTRAINT "attendance_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."attendance"
    ADD CONSTRAINT "attendance_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_profile"
    ADD CONSTRAINT "client_profile_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."site_notes"
    ADD CONSTRAINT "site_notes_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."site_notes"
    ADD CONSTRAINT "site_notes_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."site_staff"
    ADD CONSTRAINT "site_staff_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."site_staff"
    ADD CONSTRAINT "site_staff_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."site_tasks"
    ADD CONSTRAINT "site_tasks_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."site_tasks"
    ADD CONSTRAINT "site_tasks_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sites"
    ADD CONSTRAINT "sites_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."client_profile"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sites"
    ADD CONSTRAINT "sites_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."staff_profile"
    ADD CONSTRAINT "staff_profile_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";






















































































































































GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "anon";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "service_role";


















GRANT ALL ON TABLE "public"."attendance" TO "anon";
GRANT ALL ON TABLE "public"."attendance" TO "authenticated";
GRANT ALL ON TABLE "public"."attendance" TO "service_role";



GRANT ALL ON TABLE "public"."attendance_photos" TO "anon";
GRANT ALL ON TABLE "public"."attendance_photos" TO "authenticated";
GRANT ALL ON TABLE "public"."attendance_photos" TO "service_role";



GRANT ALL ON TABLE "public"."client_profile" TO "anon";
GRANT ALL ON TABLE "public"."client_profile" TO "authenticated";
GRANT ALL ON TABLE "public"."client_profile" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."quickbooks_config" TO "anon";
GRANT ALL ON TABLE "public"."quickbooks_config" TO "authenticated";
GRANT ALL ON TABLE "public"."quickbooks_config" TO "service_role";



GRANT ALL ON TABLE "public"."site_notes" TO "anon";
GRANT ALL ON TABLE "public"."site_notes" TO "authenticated";
GRANT ALL ON TABLE "public"."site_notes" TO "service_role";



GRANT ALL ON TABLE "public"."site_staff" TO "anon";
GRANT ALL ON TABLE "public"."site_staff" TO "authenticated";
GRANT ALL ON TABLE "public"."site_staff" TO "service_role";



GRANT ALL ON TABLE "public"."site_tasks" TO "anon";
GRANT ALL ON TABLE "public"."site_tasks" TO "authenticated";
GRANT ALL ON TABLE "public"."site_tasks" TO "service_role";



GRANT ALL ON TABLE "public"."sites" TO "anon";
GRANT ALL ON TABLE "public"."sites" TO "authenticated";
GRANT ALL ON TABLE "public"."sites" TO "service_role";



GRANT ALL ON TABLE "public"."staff_profile" TO "anon";
GRANT ALL ON TABLE "public"."staff_profile" TO "authenticated";
GRANT ALL ON TABLE "public"."staff_profile" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































drop extension if exists "pg_net";


  create policy "admin_all_photos"
  on "storage"."objects"
  as permissive
  for select
  to public
using (((bucket_id = 'bg-photos'::text) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text)));



  create policy "admin_upload_photos"
  on "storage"."objects"
  as permissive
  for insert
  to public
with check (((bucket_id = 'bg-photos'::text) AND (( SELECT profiles.role
   FROM public.profiles
  WHERE (profiles.id = auth.uid())) = 'admin'::text)));



  create policy "client_site_photos"
  on "storage"."objects"
  as permissive
  for select
  to public
using (((bucket_id = 'bg-photos'::text) AND (auth.uid() IN ( SELECT cp.profile_id
   FROM (((public.client_profile cp
     JOIN public.sites s ON ((s.client_id = cp.id)))
     JOIN public.attendance a ON ((a.site_id = s.id)))
     JOIN public.attendance_photos ap ON ((ap.attendance_id = a.id)))
  WHERE ((ap.before_photo_url = s.name) OR (ap.after_photo_url = s.name))))));



  create policy "staff_own_photos"
  on "storage"."objects"
  as permissive
  for select
  to public
using (((bucket_id = 'bg-photos'::text) AND (auth.uid() = ( SELECT a.staff_id
   FROM (public.attendance a
     JOIN public.attendance_photos ap ON ((ap.attendance_id = a.id)))
  WHERE ((ap.before_photo_url = objects.name) OR (ap.after_photo_url = objects.name))
 LIMIT 1))));



  create policy "staff_update_photos"
  on "storage"."objects"
  as permissive
  for update
  to public
using (((bucket_id = 'bg-photos'::text) AND (auth.uid() = ( SELECT a.staff_id
   FROM (public.attendance a
     JOIN public.attendance_photos ap ON ((ap.attendance_id = a.id)))
  WHERE ((ap.before_photo_url = objects.name) OR (ap.after_photo_url = objects.name))
 LIMIT 1))));



  create policy "staff_upload_photos"
  on "storage"."objects"
  as permissive
  for insert
  to public
with check (((bucket_id = 'bg-photos'::text) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'staff'::text)));



