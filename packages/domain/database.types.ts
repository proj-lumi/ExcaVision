export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      anomaly_analysis_runs: {
        Row: {
          analyzed_at: string
          anomaly_score: number | null
          candidate_recorded_at: string | null
          error_message: string | null
          id: number
          model_version: string
          sensor_id: string | null
          status: string
          training_points: number
        }
        Insert: {
          analyzed_at?: string
          anomaly_score?: number | null
          candidate_recorded_at?: string | null
          error_message?: string | null
          id?: never
          model_version: string
          sensor_id?: string | null
          status: string
          training_points?: number
        }
        Update: {
          analyzed_at?: string
          anomaly_score?: number | null
          candidate_recorded_at?: string | null
          error_message?: string | null
          id?: never
          model_version?: string
          sensor_id?: string | null
          status?: string
          training_points?: number
        }
        Relationships: [
          {
            foreignKeyName: "anomaly_analysis_runs_sensor_id_fkey"
            columns: ["sensor_id"]
            isOneToOne: false
            referencedRelation: "sensors"
            referencedColumns: ["id"]
          },
        ]
      }
      anomaly_events: {
        Row: {
          acknowledged_at: string | null
          anomalous_readings: number
          anomaly_score: number
          baseline_value_deg: number
          detected_at: string
          detection_method: Database["public"]["Enums"]["detection_method"]
          id: string
          model_version: string
          node_id: string
          observed_value_deg: number
          sensor_id: string
          unit_id: string
          window_size: number
          window_started_at: string
        }
        Insert: {
          acknowledged_at?: string | null
          anomalous_readings: number
          anomaly_score: number
          baseline_value_deg: number
          detected_at?: string
          detection_method?: Database["public"]["Enums"]["detection_method"]
          id?: string
          model_version?: string
          node_id: string
          observed_value_deg: number
          sensor_id: string
          unit_id: string
          window_size: number
          window_started_at: string
        }
        Update: {
          acknowledged_at?: string | null
          anomalous_readings?: number
          anomaly_score?: number
          baseline_value_deg?: number
          detected_at?: string
          detection_method?: Database["public"]["Enums"]["detection_method"]
          id?: string
          model_version?: string
          node_id?: string
          observed_value_deg?: number
          sensor_id?: string
          unit_id?: string
          window_size?: number
          window_started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "anomaly_events_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "anomaly_events_sensor_id_fkey"
            columns: ["sensor_id"]
            isOneToOne: false
            referencedRelation: "sensors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "anomaly_events_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      nodes: {
        Row: {
          archived_at: string | null
          connection_state: Database["public"]["Enums"]["node_connection_state"]
          created_at: string
          id: string
          last_seen_at: string | null
          mac_address: string
          position: number | null
          status: Database["public"]["Enums"]["node_status"]
          source_request_id: string | null
          unit_id: string | null
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          connection_state?: Database["public"]["Enums"]["node_connection_state"]
          created_at?: string
          id?: string
          last_seen_at?: string | null
          mac_address: string
          position?: number | null
          status?: Database["public"]["Enums"]["node_status"]
          source_request_id?: string | null
          unit_id?: string | null
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          connection_state?: Database["public"]["Enums"]["node_connection_state"]
          created_at?: string
          id?: string
          last_seen_at?: string | null
          mac_address?: string
          position?: number | null
          status?: Database["public"]["Enums"]["node_status"]
          source_request_id?: string | null
          unit_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "nodes_source_request_id_fkey"
            columns: ["source_request_id"]
            isOneToOne: false
            referencedRelation: "service_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nodes_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          account_status: Database["public"]["Enums"]["account_status"]
          auth_user_id: string | null
          company_name: string
          created_at: string
          email: string
          full_name: string
          id: string
          phone: string
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
        }
        Insert: {
          account_status?: Database["public"]["Enums"]["account_status"]
          auth_user_id?: string | null
          company_name?: string
          created_at?: string
          email: string
          full_name: string
          id?: string
          phone: string
          role: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Update: {
          account_status?: Database["public"]["Enums"]["account_status"]
          auth_user_id?: string | null
          company_name?: string
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          phone?: string
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Relationships: []
      }
      request_abuse_signals: {
        Row: {
          id: number
          ip_hash: string
          request_id: string | null
          submission_fingerprint: string
          submitted_at: string
          turnstile_hostname: string | null
        }
        Insert: {
          id?: never
          ip_hash: string
          request_id?: string | null
          submission_fingerprint: string
          submitted_at?: string
          turnstile_hostname?: string | null
        }
        Update: {
          id?: never
          ip_hash?: string
          request_id?: string | null
          submission_fingerprint?: string
          submitted_at?: string
          turnstile_hostname?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "request_abuse_signals_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "service_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      request_attachments: {
        Row: {
          created_at: string
          file_name: string
          id: string
          mime_type: string
          request_id: string
          size_bytes: number
          storage_path: string
        }
        Insert: {
          created_at?: string
          file_name: string
          id?: string
          mime_type: string
          request_id: string
          size_bytes: number
          storage_path: string
        }
        Update: {
          created_at?: string
          file_name?: string
          id?: string
          mime_type?: string
          request_id?: string
          size_bytes?: number
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "request_attachments_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "service_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      sensor_baselines: {
        Row: {
          baseline_x: number
          baseline_y: number
          baseline_z: number
          captured_at: string
          sensor_id: string
        }
        Insert: {
          baseline_x: number
          baseline_y: number
          baseline_z: number
          captured_at?: string
          sensor_id: string
        }
        Update: {
          baseline_x?: number
          baseline_y?: number
          baseline_z?: number
          captured_at?: string
          sensor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sensor_baselines_sensor_id_fkey"
            columns: ["sensor_id"]
            isOneToOne: true
            referencedRelation: "sensors"
            referencedColumns: ["id"]
          },
        ]
      }
      sensor_readings: {
        Row: {
          alert_flag: boolean
          failure_count: number
          gravity_magnitude_g: number | null
          id: number
          recorded_at: string
          sample_count: number
          sensor_id: string
          temperature_c: number | null
          tilt_deg: number
        }
        Insert: {
          alert_flag?: boolean
          failure_count?: number
          gravity_magnitude_g?: number | null
          id?: never
          recorded_at?: string
          sample_count?: number
          sensor_id: string
          temperature_c?: number | null
          tilt_deg: number
        }
        Update: {
          alert_flag?: boolean
          failure_count?: number
          gravity_magnitude_g?: number | null
          id?: never
          recorded_at?: string
          sample_count?: number
          sensor_id?: string
          temperature_c?: number | null
          tilt_deg?: number
        }
        Relationships: [
          {
            foreignKeyName: "sensor_readings_sensor_id_fkey"
            columns: ["sensor_id"]
            isOneToOne: false
            referencedRelation: "sensors"
            referencedColumns: ["id"]
          },
        ]
      }
      sensors: {
        Row: {
          created_at: string
          hardware_channel: number | null
          id: string
          label: string
          node_id: string
          position: number
        }
        Insert: {
          created_at?: string
          hardware_channel?: number | null
          id?: string
          label?: string
          node_id: string
          position: number
        }
        Update: {
          created_at?: string
          hardware_channel?: number | null
          id?: string
          label?: string
          node_id?: string
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "sensors_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      service_requests: {
        Row: {
          address_label: string
          company_name: string
          contact_email: string
          contact_phone: string
          details: string
          id: string
          latitude: number
          setup_step: number
          longitude: number
          request_type: Database["public"]["Enums"]["service_request_type"]
          requester_id: string | null
          requester_name: string
          completed_at: string | null
          site_id: string | null
          target_unit_id: string | null
          requested_count: number | null
          requested_nodes_per_unit: number | null
          requested_units: Json | null
          repair_report: Json | null
          site_name: string
          status: Database["public"]["Enums"]["service_request_status"]
          submitted_at: string
        }
        Insert: {
          address_label: string
          company_name?: string
          contact_email: string
          contact_phone: string
          details?: string
          id?: string
          latitude: number
          setup_step?: number
          longitude: number
          request_type: Database["public"]["Enums"]["service_request_type"]
          requester_id?: string | null
          requester_name: string
          completed_at?: string | null
          site_id?: string | null
          target_unit_id?: string | null
          requested_count?: number | null
          requested_nodes_per_unit?: number | null
          requested_units?: Json | null
          repair_report?: Json | null
          site_name: string
          status?: Database["public"]["Enums"]["service_request_status"]
          submitted_at?: string
        }
        Update: {
          address_label?: string
          company_name?: string
          contact_email?: string
          contact_phone?: string
          details?: string
          id?: string
          latitude?: number
          setup_step?: number
          longitude?: number
          request_type?: Database["public"]["Enums"]["service_request_type"]
          requester_id?: string | null
          requester_name?: string
          completed_at?: string | null
          site_id?: string | null
          target_unit_id?: string | null
          requested_count?: number | null
          requested_nodes_per_unit?: number | null
          requested_units?: Json | null
          repair_report?: Json | null
          site_name?: string
          status?: Database["public"]["Enums"]["service_request_status"]
          submitted_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_requests_requester_id_fkey"
            columns: ["requester_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_requests_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_requests_target_unit_id_fkey"
            columns: ["target_unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      sites: {
        Row: {
          address_label: string
          archived_at: string | null
          company_name: string
          created_at: string
          customer_id: string | null
          id: string
          invitation_sent_at: string | null
          invitation_status: Database["public"]["Enums"]["invitation_status"]
          latitude: number
          longitude: number
          name: string
          slug: string
          source_request_id: string
          updated_at: string
        }
        Insert: {
          address_label: string
          archived_at?: string | null
          company_name?: string
          created_at?: string
          customer_id?: string | null
          id?: string
          invitation_sent_at?: string | null
          invitation_status?: Database["public"]["Enums"]["invitation_status"]
          latitude: number
          longitude: number
          name: string
          slug: string
          source_request_id: string
          updated_at?: string
        }
        Update: {
          address_label?: string
          archived_at?: string | null
          company_name?: string
          created_at?: string
          customer_id?: string | null
          id?: string
          invitation_sent_at?: string | null
          invitation_status?: Database["public"]["Enums"]["invitation_status"]
          latitude?: number
          longitude?: number
          name?: string
          slug?: string
          source_request_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sites_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sites_source_request_id_fkey"
            columns: ["source_request_id"]
            isOneToOne: true
            referencedRelation: "service_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      threshold_events: {
        Row: {
          acknowledged_at: string | null
          detected_at: string
          id: string
          observed_value_deg: number
          sensor_id: string
          threshold_deg: number
          unit_id: string
        }
        Insert: {
          acknowledged_at?: string | null
          detected_at?: string
          id?: string
          observed_value_deg: number
          sensor_id: string
          threshold_deg: number
          unit_id: string
        }
        Update: {
          acknowledged_at?: string | null
          detected_at?: string
          id?: string
          observed_value_deg?: number
          sensor_id?: string
          threshold_deg?: number
          unit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "threshold_events_sensor_id_fkey"
            columns: ["sensor_id"]
            isOneToOne: false
            referencedRelation: "sensors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "threshold_events_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      units: {
        Row: {
          alert_threshold_deg: number
          archived_at: string | null
          created_at: string
          id: string
          name: string
          site_id: string
          source_request_id: string | null
          source_request_unit_index: number | null
          slug: string
          status: Database["public"]["Enums"]["unit_status"]
          updated_at: string
        }
        Insert: {
          alert_threshold_deg?: number
          archived_at?: string | null
          created_at?: string
          id?: string
          name: string
          site_id: string
          source_request_id?: string | null
          source_request_unit_index?: number | null
          slug: string
          status?: Database["public"]["Enums"]["unit_status"]
          updated_at?: string
        }
        Update: {
          alert_threshold_deg?: number
          archived_at?: string | null
          created_at?: string
          id?: string
          name?: string
          site_id?: string
          source_request_id?: string | null
          source_request_unit_index?: number | null
          slug?: string
          status?: Database["public"]["Enums"]["unit_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "units_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "units_source_request_id_fkey"
            columns: ["source_request_id"]
            isOneToOne: false
            referencedRelation: "service_requests"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      acknowledge_anomaly_event: {
        Args: { target_event_id: string }
        Returns: undefined
      }
      acknowledge_threshold_event: {
        Args: { target_event_id: string }
        Returns: undefined
      }
      activate_customer: { Args: never; Returns: undefined }
      archive_node: { Args: { target_node_id: string }; Returns: undefined }
      archive_site: { Args: { target_site_id: string }; Returns: undefined }
      archive_unit: { Args: { target_unit_id: string }; Returns: undefined }
      assign_node: {
        Args: { target_node_id: string; target_unit_id: string }
        Returns: undefined
      }
      assign_node_for_add_unit_request: {
        Args: { target_node_id: string; target_request_id: string; target_unit_id: string }
        Returns: undefined
      }
      assign_node_for_request: {
        Args: { target_node_id: string; target_request_id: string }
        Returns: undefined
      }
      authenticate_gateway_by_mac: {
        Args: { target_mac: string }
        Returns: string
      }
      approve_request_resources: {
        Args: { target_request_id: string }
        Returns: Json
      }
      create_site_from_request: {
        Args: { target_request_id: string; target_site_name: string }
        Returns: string
      }
      current_profile_id: { Args: never; Returns: string }
      get_customer_recent_readings: {
        Args: { points_per_sensor?: number }
        Returns: {
          alert_flag: boolean
          failure_count: number
          gravity_magnitude_g: number | null
          id: number
          recorded_at: string
          sample_count: number
          sensor_id: string
          temperature_c: number | null
          tilt_deg: number
        }[]
        SetofOptions: {
          from: "*"
          to: "sensor_readings"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_node_config: {
        Args: { target_gateway_id: string; target_mac: string }
        Returns: {
          threshold_deg: number
        }[]
      }
      get_sensor_baselines: {
        Args: { target_gateway_id: string; target_mac: string }
        Returns: {
          bx: number
          by: number
          bz: number
          channel: number
        }[]
      }
      ingest_node_readings: {
        Args: { target_gateway_id: string; target_readings: Json }
        Returns: number
      }
      is_admin: { Args: never; Returns: boolean }
      owns_site: { Args: { target_site_id: string }; Returns: boolean }
      provision_node_sensors: {
        Args: { target_node_id: string }
        Returns: undefined
      }
      record_isolation_forest_event: {
        Args: {
          target_anomalous_readings: number
          target_anomaly_score: number
          target_baseline_value_deg: number
          target_model_version: string
          target_observed_value_deg: number
          target_sensor_id: string
          target_window_size: number
          target_window_started_at: string
        }
        Returns: string
      }
      record_node_threshold_event: {
        Args: {
          target_channel: number
          target_gateway_id: string
          target_mac: string
          target_observed_value_deg: number
        }
        Returns: string
      }
      register_node: { Args: { target_mac: string }; Returns: Json }
      reorder_unit_node: {
        Args: { target_node_id: string; target_position: number }
        Returns: undefined
      }
      reserve_public_intake: {
        Args: {
          target_fingerprint: string
          target_hostname: string
          target_ip_hash: string
        }
        Returns: number
      }
      submit_customer_request: {
        Args: {
          target_details: string
          target_request_type: Database["public"]["Enums"]["service_request_type"]
          target_site_id: string
          target_unit_id?: string | null
          target_requested_count?: number | null
          target_requested_nodes_per_unit?: number | null
          target_requested_units?: Json | null
          target_repair_report?: Json | null
        }
        Returns: string
      }
      sync_unit_status: { Args: { target_unit_id: string }; Returns: undefined }
      update_unit_threshold: {
        Args: { new_threshold_deg: number; target_unit_id: string }
        Returns: undefined
      }
      upsert_sensor_baseline: {
        Args: {
          target_baseline_x: number
          target_baseline_y: number
          target_baseline_z: number
          target_channel: number
          target_gateway_id: string
          target_mac: string
        }
        Returns: undefined
      }
    }
    Enums: {
      account_status: "pending" | "active" | "disabled"
      detection_method: "isolation_forest"
      invitation_status: "not_invited" | "invited" | "activated"
      node_connection_state:
        | "cloud_online"
        | "local_reporting"
        | "offline"
        | "unknown"
      node_status: "unassigned" | "assigned" | "archived"
      service_request_status: "open" | "completed" | "spam"
      service_request_type:
        | "site_installation"
        | "add_unit"
        | "add_nodes"
        | "repair"
      unit_status: "setup_pending" | "active" | "archived"
      user_role: "admin" | "customer"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      account_status: ["pending", "active", "disabled"],
      detection_method: ["isolation_forest"],
      invitation_status: ["not_invited", "invited", "activated"],
      node_connection_state: [
        "cloud_online",
        "local_reporting",
        "offline",
        "unknown",
      ],
      node_status: ["unassigned", "assigned", "archived"],
      service_request_status: ["open", "completed", "spam"],
      service_request_type: [
        "site_installation",
        "add_unit",
        "add_nodes",
        "repair",
      ],
      unit_status: ["setup_pending", "active", "archived"],
      user_role: ["admin", "customer"],
    },
  },
} as const

