export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: '14.5';
  };
  public: {
    Tables: {
      attachments: {
        Row: {
          capture_id: string;
          created_at: string;
          id: string;
          mime_type: string;
          original_name: string;
          size_bytes: number;
          storage_path: string;
          user_id: string;
        };
        Insert: {
          capture_id: string;
          created_at?: string;
          id?: string;
          mime_type: string;
          original_name: string;
          size_bytes: number;
          storage_path: string;
          user_id: string;
        };
        Update: {
          capture_id?: string;
          created_at?: string;
          id?: string;
          mime_type?: string;
          original_name?: string;
          size_bytes?: number;
          storage_path?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'attachments_capture_owner_fkey';
            columns: ['capture_id', 'user_id'];
            isOneToOne: false;
            referencedRelation: 'captures';
            referencedColumns: ['id', 'user_id'];
          },
        ];
      };
      capture_tags: {
        Row: {
          capture_id: string;
          created_at: string;
          tag_id: string;
          user_id: string;
        };
        Insert: {
          capture_id: string;
          created_at?: string;
          tag_id: string;
          user_id: string;
        };
        Update: {
          capture_id?: string;
          created_at?: string;
          tag_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'capture_tags_capture_owner_fkey';
            columns: ['capture_id', 'user_id'];
            isOneToOne: false;
            referencedRelation: 'captures';
            referencedColumns: ['id', 'user_id'];
          },
          {
            foreignKeyName: 'capture_tags_tag_owner_fkey';
            columns: ['tag_id', 'user_id'];
            isOneToOne: false;
            referencedRelation: 'tags';
            referencedColumns: ['id', 'user_id'];
          },
        ];
      };
      captures: {
        Row: {
          archived_at: string | null;
          content: string | null;
          created_at: string;
          id: string;
          is_favorite: boolean;
          kind: string;
          source_url: string | null;
          status: string;
          title: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          archived_at?: string | null;
          content?: string | null;
          created_at?: string;
          id?: string;
          is_favorite?: boolean;
          kind: string;
          source_url?: string | null;
          status?: string;
          title?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          archived_at?: string | null;
          content?: string | null;
          created_at?: string;
          id?: string;
          is_favorite?: boolean;
          kind?: string;
          source_url?: string | null;
          status?: string;
          title?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      tags: {
        Row: {
          created_at: string;
          id: string;
          name: string;
          normalized_name: string | null;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          name: string;
          normalized_name?: string | null;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          name?: string;
          normalized_name?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      delete_image_capture_after_storage: {
        Args: { p_capture_id: string };
        Returns: boolean;
      };
      finalize_image_capture: {
        Args: {
          p_attachment_id: string;
          p_capture_id: string;
          p_content?: string;
          p_mime_type: string;
          p_original_name: string;
          p_size_bytes: number;
          p_storage_path: string;
          p_title?: string;
        };
        Returns: {
          created_attachment_id: string;
          created_capture_id: string;
        }[];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
