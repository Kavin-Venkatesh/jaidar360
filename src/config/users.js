// Hard-coded builder logins, one admin per tenant. Prototype only: move to the DB with hashed passwords
// before any real customer uses this.
module.exports = [
  { username: "acme_admin", password: "Acme@123", tenantId: "tnt_acme", name: "Acme Admin" },
  { username: "fresh_admin", password: "Fresh@123", tenantId: "tnt_freshmart", name: "FreshMart Admin" },
];
