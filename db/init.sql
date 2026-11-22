\set ON_ERROR_STOP on

CREATE ROLE groupride_setup LOGIN PASSWORD 'local_setup';
CREATE ROLE groupride_app LOGIN PASSWORD 'local_app';
CREATE DATABASE groupride_demo OWNER groupride_setup;
CREATE DATABASE groupride_test OWNER groupride_setup;

REVOKE CONNECT, TEMPORARY ON DATABASE groupride_demo, groupride_test FROM PUBLIC;
GRANT CONNECT ON DATABASE groupride_demo, groupride_test TO groupride_app;

\connect groupride_demo
CREATE SCHEMA groupride_local;
CREATE TABLE groupride_local.designation (
  name text PRIMARY KEY CHECK (name = 'groupride_demo')
);
INSERT INTO groupride_local.designation VALUES ('groupride_demo');
GRANT USAGE ON SCHEMA groupride_local TO groupride_setup;
GRANT SELECT ON groupride_local.designation TO groupride_setup;

\connect groupride_test
CREATE SCHEMA groupride_local;
CREATE TABLE groupride_local.designation (
  name text PRIMARY KEY CHECK (name = 'groupride_test')
);
INSERT INTO groupride_local.designation VALUES ('groupride_test');
GRANT USAGE ON SCHEMA groupride_local TO groupride_setup;
GRANT SELECT ON groupride_local.designation TO groupride_setup;
