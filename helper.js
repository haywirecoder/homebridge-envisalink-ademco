'use strict'

// Function to determine if value provide is in between min and max value. 
// If value is not between min and max return default value provided.

exports.toIntBetween = function (value, minValue, maxValue, defaultValue) {
  const n = Number(value)
  if (isNaN(n) || n !== Math.floor(n) || n < minValue || n > maxValue) {
    return defaultValue
  }
  return n
}
