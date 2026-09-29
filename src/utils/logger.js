function logInfo(event, details = {}) {
  console.log(JSON.stringify({ event, timestamp: new Date().toISOString(), ...details }));
}

function logError(event, error, details = {}) {
  console.error(JSON.stringify({ event, timestamp: new Date().toISOString(), error: error && error.message ? error.message : String(error), ...details }));
}

module.exports = {
  logInfo,
  logError,
};
