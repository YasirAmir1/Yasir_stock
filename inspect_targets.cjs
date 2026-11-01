const fs = require('fs');

async function inspect() {
  try {
    const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
    console.log("ProjectId:", firebaseConfig.projectId);
  } catch (e) {
    console.error(e);
  }
}

inspect();
