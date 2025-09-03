#!/bin/bash

# Ensure data directory exists
mkdir -p data

# Check if bcrypt is installed
if ! npm list bcrypt >/dev/null 2>&1; then
  echo "Installing bcrypt..."
  npm install bcrypt
fi

# Prompt for Admin password
echo -n "Enter Admin password: "
read -s admin_pass1
echo
echo -n "Confirm Admin password: "
read -s admin_pass2
echo

if [ "$admin_pass1" != "$admin_pass2" ]; then
  echo "Passwords do not match. Exiting."
  exit 1
fi

# Prompt for Moderator username
echo -n "Enter Moderator username: "
read mod_user

# Prompt for Moderator password
echo -n "Enter Moderator password: "
read -s mod_pass1
echo
echo -n "Confirm Moderator password: "
read -s mod_pass2
echo

if [ "$mod_pass1" != "$mod_pass2" ]; then
  echo "Passwords do not match. Exiting."
  exit 1
fi

# Run Node.js to hash passwords and write JSON files
node <<EOF
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');

const adminPassword = '$admin_pass1';
const modUsername = '$mod_user';
const modPassword = '$mod_pass1';
const saltRounds = 10;

(async () => {
  const adminHash = await bcrypt.hash(adminPassword, saltRounds);
  const modHash = await bcrypt.hash(modPassword, saltRounds);

  const users = [
    { username: "Admin", password: adminHash },
    { username: modUsername, password: modHash }
  ];

  const usersPath = path.join(__dirname, 'data', 'users.json');
  fs.writeFileSync(usersPath, JSON.stringify(users, null, 2));

  const adminPath = path.join(__dirname, 'data', 'admin.json');
  fs.writeFileSync(adminPath, JSON.stringify({ username: modUsername.toLowerCase() }, null, 2));

  console.log("Created users.json and admin.json.");
})();
EOF
