-- Fix RLS for chat tables used by the app (chat_rooms/chat_room_members/chat_messages)

-- Drop all existing policies to avoid conflicts/restrictive policies.
DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('chat_rooms', 'chat_room_members', 'chat_messages')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I;', pol.policyname, pol.schemaname, pol.tablename);
  END LOOP;
END $$;

-- Ensure RLS is enabled
ALTER TABLE public.chat_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_room_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

-- Helper functions (SECURITY DEFINER) to avoid recursion in policies
CREATE OR REPLACE FUNCTION public.is_chat_room_member(p_room_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.chat_room_members m
    WHERE m.room_id = p_room_id
      AND m.user_id = p_user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.is_chat_room_public(p_room_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.chat_rooms r
    WHERE r.id = p_room_id
      AND r.is_public = true
  );
$$;

CREATE OR REPLACE FUNCTION public.chat_room_created_by(p_room_id uuid)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.created_by
  FROM public.chat_rooms r
  WHERE r.id = p_room_id;
$$;

-- chat_rooms
CREATE POLICY "chat_rooms_select"
ON public.chat_rooms
FOR SELECT
TO authenticated
USING (
  is_public = true
  OR created_by = auth.uid()
  OR public.is_chat_room_member(id, auth.uid())
);

CREATE POLICY "chat_rooms_insert"
ON public.chat_rooms
FOR INSERT
TO authenticated
WITH CHECK (
  created_by = auth.uid()
);

CREATE POLICY "chat_rooms_update"
ON public.chat_rooms
FOR UPDATE
TO authenticated
USING (
  created_by = auth.uid()
)
WITH CHECK (
  created_by = auth.uid()
);

-- chat_room_members
CREATE POLICY "chat_room_members_select"
ON public.chat_room_members
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR public.is_chat_room_public(room_id)
  OR public.is_chat_room_member(room_id, auth.uid())
);

CREATE POLICY "chat_room_members_insert"
ON public.chat_room_members
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() IS NOT NULL
  AND (
    user_id = auth.uid()
    OR public.chat_room_created_by(room_id) = auth.uid()
  )
);

CREATE POLICY "chat_room_members_update"
ON public.chat_room_members
FOR UPDATE
TO authenticated
USING (
  user_id = auth.uid()
)
WITH CHECK (
  user_id = auth.uid()
);

CREATE POLICY "chat_room_members_delete"
ON public.chat_room_members
FOR DELETE
TO authenticated
USING (
  public.chat_room_created_by(room_id) = auth.uid()
);

-- chat_messages
CREATE POLICY "chat_messages_select"
ON public.chat_messages
FOR SELECT
TO authenticated
USING (
  public.is_chat_room_public(room_id)
  OR public.is_chat_room_member(room_id, auth.uid())
);

CREATE POLICY "chat_messages_insert"
ON public.chat_messages
FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND (
    public.is_chat_room_public(room_id)
    OR public.is_chat_room_member(room_id, auth.uid())
  )
);
