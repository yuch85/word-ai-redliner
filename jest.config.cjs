module.exports = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.js$': 'babel-jest'
  },
  moduleFileExtensions: ['js'],
  testMatch: ['**/tests/**/*.spec.js'],
  collectCoverageFrom: [
    'src/lib/**/*.js'
  ],
  coverageDirectory: 'coverage',
  verbose: true
};

