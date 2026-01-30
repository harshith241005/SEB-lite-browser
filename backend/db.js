/**
 * Database helper functions for SEB-Lite
 * Provides abstraction layer for User operations
 */

const User = require('./models/User');

/**
 * Find a user by query criteria
 * @param {Object} query - MongoDB query object
 * @returns {Promise<Object|null>} User document or null
 */
async function findUser(query) {
  try {
    return await User.findOne(query);
  } catch (error) {
    console.error('Error finding user:', error);
    throw error;
  }
}

/**
 * Create a new user
 * @param {Object} userData - User data object
 * @returns {Promise<Object>} Created user document
 */
async function createUser(userData) {
  try {
    const user = new User(userData);
    await user.save();
    return user;
  } catch (error) {
    console.error('Error creating user:', error);
    throw error;
  }
}

/**
 * Update a user by ID
 * @param {string} userId - User ID
 * @param {Object} updates - Fields to update
 * @returns {Promise<Object|null>} Updated user document
 */
async function updateUser(userId, updates) {
  try {
    return await User.findByIdAndUpdate(userId, updates, { new: true });
  } catch (error) {
    console.error('Error updating user:', error);
    throw error;
  }
}

/**
 * Delete a user by ID
 * @param {string} userId - User ID
 * @returns {Promise<Object|null>} Deleted user document
 */
async function deleteUser(userId) {
  try {
    return await User.findByIdAndDelete(userId);
  } catch (error) {
    console.error('Error deleting user:', error);
    throw error;
  }
}

/**
 * Find all users matching query
 * @param {Object} query - MongoDB query object
 * @returns {Promise<Array>} Array of user documents
 */
async function findUsers(query = {}) {
  try {
    return await User.find(query);
  } catch (error) {
    console.error('Error finding users:', error);
    throw error;
  }
}

module.exports = {
  findUser,
  createUser,
  updateUser,
  deleteUser,
  findUsers
};
