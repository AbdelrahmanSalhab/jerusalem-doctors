
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "applied_migrations": {
                  Row: {
                    "applied_at": string,"name": string
                  }
                  ComputedFields: never
                  Insert: {
                    "applied_at"?: string,"name": string
                  }
                  Update: {
                    "applied_at"?: string,"name"?: string
                  }
                  Relationships: [
                    
                  ]
                },"audit_logs": {
                  Row: {
                    "action": string,"actor_doctor_id": string | null,"created_at": string,"id": string,"metadata": Json | null,"target_doctor_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_doctor_id"?: string | null,"created_at"?: string,"id"?: string,"metadata"?: Json | null,"target_doctor_id"?: string | null
                  }
                  Update: {
                    "action"?: string,"actor_doctor_id"?: string | null,"created_at"?: string,"id"?: string,"metadata"?: Json | null,"target_doctor_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "audit_logs_actor_doctor_id_fkey"
      columns: ["actor_doctor_id"]
isOneToOne: false
      referencedRelation: "doctors"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "audit_logs_target_doctor_id_fkey"
      columns: ["target_doctor_id"]
isOneToOne: false
      referencedRelation: "doctors"
      referencedColumns: ["id"]
    }
                  ]
                },"doctor_license_slots": {
                  Row: {
                    "doctor_id": string,"license_number": string,"license_region": string,"slot": string
                  }
                  ComputedFields: never
                  Insert: {
                    "doctor_id": string,"license_number": string,"license_region": string,"slot": string
                  }
                  Update: {
                    "doctor_id"?: string,"license_number"?: string,"license_region"?: string,"slot"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "doctor_license_slots_doctor_id_fkey"
      columns: ["doctor_id"]
isOneToOne: false
      referencedRelation: "doctors"
      referencedColumns: ["id"]
    }
                  ]
                },"doctor_specialties": {
                  Row: {
                    "doctor_id": string,"specialty_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "doctor_id": string,"specialty_id": string
                  }
                  Update: {
                    "doctor_id"?: string,"specialty_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "doctor_specialties_doctor_id_fkey"
      columns: ["doctor_id"]
isOneToOne: false
      referencedRelation: "doctors"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "doctor_specialties_specialty_id_fkey"
      columns: ["specialty_id"]
isOneToOne: false
      referencedRelation: "specialties"
      referencedColumns: ["id"]
    }
                  ]
                },"doctor_workplaces": {
                  Row: {
                    "address": string | null,"created_at": string,"details": string | null,"doctor_id": string,"hmo_id": string | null,"hours": string | null,"id": string,"institution_id": string | null,"is_primary": boolean,"name": string,"name_normalized": string,"phone": string | null,"sort_order": number,"updated_at": string,"workplace_type": string
                  }
                  ComputedFields: never
                  Insert: {
                    "address"?: string | null,"created_at"?: string,"details"?: string | null,"doctor_id": string,"hmo_id"?: string | null,"hours"?: string | null,"id"?: string,"institution_id"?: string | null,"is_primary"?: boolean,"name": string,"name_normalized": string,"phone"?: string | null,"sort_order"?: number,"updated_at"?: string,"workplace_type"?: string
                  }
                  Update: {
                    "address"?: string | null,"created_at"?: string,"details"?: string | null,"doctor_id"?: string,"hmo_id"?: string | null,"hours"?: string | null,"id"?: string,"institution_id"?: string | null,"is_primary"?: boolean,"name"?: string,"name_normalized"?: string,"phone"?: string | null,"sort_order"?: number,"updated_at"?: string,"workplace_type"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "doctor_workplaces_doctor_id_fkey"
      columns: ["doctor_id"]
isOneToOne: false
      referencedRelation: "doctors"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "doctor_workplaces_hmo_id_fkey"
      columns: ["hmo_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "doctor_workplaces_institution_id_fkey"
      columns: ["institution_id"]
isOneToOne: false
      referencedRelation: "institutions"
      referencedColumns: ["id"]
    }
                  ]
                },"doctors": {
                  Row: {
                    "arabic_family_name": string,"arabic_family_name_normalized": string,"arabic_first_name": string,"arabic_first_name_normalized": string,"arabic_full_name": string | null,"arabic_full_name_normalized": string,"auth_user_id": string | null,"bio": string | null,"career_stage": string | null,"certificates": (string)[],"certificates_normalized": string | null,"consent_directory_use": boolean,"consent_timestamp": string,"created_at": string,"email": string | null,"featured": string | null,"featured_at": string | null,"hebrew_family_name": string | null,"hebrew_first_name": string | null,"hebrew_full_name": string | null,"id": string,"is_active": boolean,"is_admin": boolean,"is_admin_approved": boolean,"is_phone_verified": boolean,"is_visible": boolean,"license_number": string,"license_region": string,"license_verification_status": string | null,"license_verified_at": string | null,"phone_display": string | null,"phone_e164": string,"profile_picture_url": string | null,"residency_start_year": number | null,"retired": boolean,"secondary_license_number": string | null,"secondary_license_region": string | null,"secondary_license_verification_status": string | null,"seeking_work": boolean,"subspecialty": string | null,"subspecialty_normalized": string | null,"updated_at": string,"clinic_missing_details": boolean | null,"registry_specialty": string | null
                  }
                  ComputedFields: "clinic_missing_details" | "registry_specialty"
                  Insert: {
                    "arabic_family_name": string,"arabic_family_name_normalized": string,"arabic_first_name": string,"arabic_first_name_normalized": string,"arabic_full_name"?: never,"arabic_full_name_normalized": string,"auth_user_id"?: string | null,"bio"?: string | null,"career_stage"?: string | null,"certificates"?: (string)[],"certificates_normalized"?: string | null,"consent_directory_use"?: boolean,"consent_timestamp"?: string,"created_at"?: string,"email"?: string | null,"featured"?: string | null,"featured_at"?: string | null,"hebrew_family_name"?: string | null,"hebrew_first_name"?: string | null,"hebrew_full_name"?: never,"id"?: string,"is_active"?: boolean,"is_admin"?: boolean,"is_admin_approved"?: boolean,"is_phone_verified"?: boolean,"is_visible"?: boolean,"license_number": string,"license_region"?: string,"license_verification_status"?: string | null,"license_verified_at"?: string | null,"phone_display"?: string | null,"phone_e164": string,"profile_picture_url"?: string | null,"residency_start_year"?: number | null,"retired"?: boolean,"secondary_license_number"?: string | null,"secondary_license_region"?: string | null,"secondary_license_verification_status"?: string | null,"seeking_work"?: boolean,"subspecialty"?: string | null,"subspecialty_normalized"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "arabic_family_name"?: string,"arabic_family_name_normalized"?: string,"arabic_first_name"?: string,"arabic_first_name_normalized"?: string,"arabic_full_name"?: never,"arabic_full_name_normalized"?: string,"auth_user_id"?: string | null,"bio"?: string | null,"career_stage"?: string | null,"certificates"?: (string)[],"certificates_normalized"?: string | null,"consent_directory_use"?: boolean,"consent_timestamp"?: string,"created_at"?: string,"email"?: string | null,"featured"?: string | null,"featured_at"?: string | null,"hebrew_family_name"?: string | null,"hebrew_first_name"?: string | null,"hebrew_full_name"?: never,"id"?: string,"is_active"?: boolean,"is_admin"?: boolean,"is_admin_approved"?: boolean,"is_phone_verified"?: boolean,"is_visible"?: boolean,"license_number"?: string,"license_region"?: string,"license_verification_status"?: string | null,"license_verified_at"?: string | null,"phone_display"?: string | null,"phone_e164"?: string,"profile_picture_url"?: string | null,"residency_start_year"?: number | null,"retired"?: boolean,"secondary_license_number"?: string | null,"secondary_license_region"?: string | null,"secondary_license_verification_status"?: string | null,"seeking_work"?: boolean,"subspecialty"?: string | null,"subspecialty_normalized"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"institutions": {
                  Row: {
                    "aliases": (string)[],"created_at": string,"id": string,"kind": string,"name_ar": string,"name_he": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "aliases"?: (string)[],"created_at"?: string,"id"?: string,"kind": string,"name_ar": string,"name_he"?: string | null
                  }
                  Update: {
                    "aliases"?: (string)[],"created_at"?: string,"id"?: string,"kind"?: string,"name_ar"?: string,"name_he"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"metrics_daily": {
                  Row: {
                    "counts": NonNullable<Json>,"day": string,"db_bytes": number,"recorded_at": string,"top_tables": NonNullable<Json>
                  }
                  ComputedFields: never
                  Insert: {
                    "counts": NonNullable<Json>,"day": string,"db_bytes": number,"recorded_at"?: string,"top_tables": NonNullable<Json>
                  }
                  Update: {
                    "counts"?: NonNullable<Json>,"day"?: string,"db_bytes"?: number,"recorded_at"?: string,"top_tables"?: NonNullable<Json>
                  }
                  Relationships: [
                    
                  ]
                },"moh_practitioners": {
                  Row: {
                    "hebrew_family_name": string,"hebrew_family_norm": string,"hebrew_first_name": string,"hebrew_first_norm": string,"license_issued_on": string | null,"license_issued_yyyymmdd": number | null,"license_number": number,"specialist_since": string | null,"specialties": (string)[],"specialty_name_he": string | null,"synced_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "hebrew_family_name": string,"hebrew_family_norm": string,"hebrew_first_name": string,"hebrew_first_norm": string,"license_issued_on"?: string | null,"license_issued_yyyymmdd"?: number | null,"license_number": number,"specialist_since"?: string | null,"specialties"?: (string)[],"specialty_name_he"?: string | null,"synced_at"?: string
                  }
                  Update: {
                    "hebrew_family_name"?: string,"hebrew_family_norm"?: string,"hebrew_first_name"?: string,"hebrew_first_norm"?: string,"license_issued_on"?: string | null,"license_issued_yyyymmdd"?: number | null,"license_number"?: number,"specialist_since"?: string | null,"specialties"?: (string)[],"specialty_name_he"?: string | null,"synced_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"number_requests": {
                  Row: {
                    "created_at": string,"id": string,"query": string,"requester_id": string,"resolved_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"query": string,"requester_id": string,"resolved_at"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"query"?: string,"requester_id"?: string,"resolved_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "number_requests_requester_id_fkey"
      columns: ["requester_id"]
isOneToOne: false
      referencedRelation: "doctors"
      referencedColumns: ["id"]
    }
                  ]
                },"pending_signups": {
                  Row: {
                    "attempts": number,"created_at": string,"expires_at": string,"id": string,"payload": NonNullable<Json>,"phone_e164": string,"reminded_at": string | null,"resume_token_hash": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "attempts"?: number,"created_at"?: string,"expires_at": string,"id"?: string,"payload": NonNullable<Json>,"phone_e164": string,"reminded_at"?: string | null,"resume_token_hash"?: string | null
                  }
                  Update: {
                    "attempts"?: number,"created_at"?: string,"expires_at"?: string,"id"?: string,"payload"?: NonNullable<Json>,"phone_e164"?: string,"reminded_at"?: string | null,"resume_token_hash"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"profile_reports": {
                  Row: {
                    "created_at": string,"details": string,"id": string,"license_number": string | null,"reporter_contact": string | null,"reporter_doctor_id": string | null,"reporter_name": string | null,"resolution_note": string | null,"resolved_at": string | null,"resolved_by": string | null,"source": string,"target_doctor_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"details": string,"id"?: string,"license_number"?: string | null,"reporter_contact"?: string | null,"reporter_doctor_id"?: string | null,"reporter_name"?: string | null,"resolution_note"?: string | null,"resolved_at"?: string | null,"resolved_by"?: string | null,"source": string,"target_doctor_id"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"details"?: string,"id"?: string,"license_number"?: string | null,"reporter_contact"?: string | null,"reporter_doctor_id"?: string | null,"reporter_name"?: string | null,"resolution_note"?: string | null,"resolved_at"?: string | null,"resolved_by"?: string | null,"source"?: string,"target_doctor_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "profile_reports_reporter_doctor_id_fkey"
      columns: ["reporter_doctor_id"]
isOneToOne: false
      referencedRelation: "doctors"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "profile_reports_resolved_by_fkey"
      columns: ["resolved_by"]
isOneToOne: false
      referencedRelation: "doctors"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "profile_reports_target_doctor_id_fkey"
      columns: ["target_doctor_id"]
isOneToOne: false
      referencedRelation: "doctors"
      referencedColumns: ["id"]
    }
                  ]
                },"specialties": {
                  Row: {
                    "code": string | null,"id": string,"is_active": boolean,"name_ar": string,"name_ar_normalized": string,"name_en": string | null,"name_he": string | null,"parent_id": string | null,"sort_order": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "code"?: string | null,"id"?: string,"is_active"?: boolean,"name_ar": string,"name_ar_normalized": string,"name_en"?: string | null,"name_he"?: string | null,"parent_id"?: string | null,"sort_order"?: number | null
                  }
                  Update: {
                    "code"?: string | null,"id"?: string,"is_active"?: boolean,"name_ar"?: string,"name_ar_normalized"?: string,"name_en"?: string | null,"name_he"?: string | null,"parent_id"?: string | null,"sort_order"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "specialties_parent_id_fkey"
      columns: ["parent_id"]
isOneToOne: false
      referencedRelation: "specialties"
      referencedColumns: ["id"]
    }
                  ]
                },"usage_events": {
                  Row: {
                    "created_at": string,"doctor_id": string | null,"id": number,"kind": string,"meta": Json | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"doctor_id"?: string | null,"id"?: never,"kind": string,"meta"?: Json | null
                  }
                  Update: {
                    "created_at"?: string,"doctor_id"?: string | null,"id"?: never,"kind"?: string,"meta"?: Json | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "usage_events_doctor_id_fkey"
      columns: ["doctor_id"]
isOneToOne: false
      referencedRelation: "doctors"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "admin_audit_events":
{ Args: { "p_action"?: string,"p_from"?: string,"p_limit"?: number,"p_offset"?: number,"p_people_only"?: boolean,"p_term"?: string,"p_to"?: string }; Returns: {
              "action": string,"actor_doctor_id": string,"created_at": string,"id": string,"metadata": Json,"target_doctor_id": string,"total": number
            }[]
                           },
"admin_stats":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"clinic_missing_details":
{ Args: { "d": Omit<Database["public"]['Tables']["doctors"]['Row'], Database["public"]['Tables']["doctors"]['ComputedFields']> }; Returns: boolean
                           },
"directory_counts":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"install_funnel":
{ Args: { "p_days"?: number }; Returns: {
              "doctors": number,"events": number,"kind": string,"platform": string
            }[]
                           },
"otp_stats":
{ Args: { "p_days"?: number,"p_valid_seconds"?: number }; Returns: Json
                           },
"record_daily_metrics":
{ Args: { "p_day": string }; Returns: Json
                           },
"registry_specialty":
{ Args: { "d": Omit<Database["public"]['Tables']["doctors"]['Row'], Database["public"]['Tables']["doctors"]['ComputedFields']> }; Returns: string
                           },
"save_doctor_profile":
{ Args: { "p_doctor_id": string,"p_specialty_ids": (string)[],"p_updates": Json,"p_workplaces": Json }; Returns: undefined
                           },
"search_directory":
{ Args: { "p_institution_ids"?: (string)[],"p_limit"?: number,"p_seeking_work"?: boolean,"p_specialty_id"?: string,"p_stage"?: string,"p_term"?: string,"p_workplace_institution"?: string,"p_workplace_type"?: string }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            
          }
        }
} as const
