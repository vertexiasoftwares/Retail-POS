ALTER TABLE vtx_central.central_sessions
  DROP CONSTRAINT IF EXISTS central_sessions_user_id_fkey;

ALTER TABLE vtx_central.central_users
  DROP CONSTRAINT IF EXISTS central_users_pkey;

ALTER TABLE vtx_central.central_users
  ADD PRIMARY KEY (shop_uuid, id);

ALTER TABLE vtx_central.central_sessions
  DROP CONSTRAINT IF EXISTS central_sessions_shop_user_fkey;

ALTER TABLE vtx_central.central_sessions
  ADD CONSTRAINT central_sessions_shop_user_fkey
  FOREIGN KEY (shop_uuid, user_id)
  REFERENCES vtx_central.central_users(shop_uuid, id)
  ON DELETE CASCADE;
