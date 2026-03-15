/**
 * EFRIT Pattern Examples for SuperClaw
 * 
 * Practical examples showing how to use EFRIT execution patterns
 * for real-world development tasks.
 */

import { getToolRegistry } from './registry';
import { createEfritEngine, EfritExecutionEngine, EfritSessionState } from './efrit-patterns';

/**
 * Example 1: Building a REST API with EFRIT patterns
 * 
 * This example shows how Claude would orchestrate multiple tools
 * to build a complete REST API with authentication.
 */
export async function buildRestApiExample(): Promise<void> {
  const registry = getToolRegistry();
  const efrit = createEfritEngine(registry, './.efrit-api-example');

  console.log('🚀 Starting REST API development with EFRIT patterns...');

  // Create session with project context
  const sessionId = await efrit.createSession(
    "Build a complete REST API for a task management system with user authentication, CRUD operations, and proper error handling",
    {
      workingDirectory: './api-project',
      projectRoot: './api-project',
      safetyLevel: 'safe',
      maxToolCalls: 50
    }
  );

  try {
    // Phase 1: Project Setup
    console.log('📋 Phase 1: Setting up project structure...');
    
    let result = await efrit.executeNaturalLanguage(
      sessionId,
      `Initialize a new Node.js TypeScript project with the following structure:
       - src/ (source code)
       - src/routes/ (API routes)
       - src/models/ (data models)  
       - src/middleware/ (auth and validation)
       - src/utils/ (utility functions)
       - tests/ (test files)
       - docs/ (API documentation)
       Create package.json with Express, TypeScript, Jest, and other necessary dependencies.`
    );

    if (!result.success) {
      throw new Error(`Project setup failed: ${result.error}`);
    }

    // Create checkpoint after project setup
    const session = (efrit as any).sessions.get(sessionId) as EfritSessionState;
    await efrit.createCheckpoint(session, "Project structure created");

    // Phase 2: Database Schema Design
    console.log('🗄️ Phase 2: Designing database schema...');
    
    result = await efrit.executeNaturalLanguage(
      sessionId,
      `Design and implement a PostgreSQL database schema for the task management system:
       - Users table (id, email, password_hash, created_at, updated_at)
       - Tasks table (id, title, description, status, priority, due_date, user_id, created_at, updated_at)
       - Categories table (id, name, color, user_id)
       - TaskCategories junction table
       Create migration files and database connection utilities.`
    );

    await efrit.createCheckpoint(session, "Database schema designed");

    // Phase 3: Authentication System  
    console.log('🔐 Phase 3: Implementing authentication...');
    
    result = await efrit.executeNaturalLanguage(
      sessionId,
      `Build a secure authentication system:
       - JWT token generation and validation
       - Password hashing with bcrypt
       - Login endpoint (/auth/login)
       - Register endpoint (/auth/register)
       - Password reset functionality
       - Auth middleware for protecting routes
       Follow security best practices and include input validation.`,
      "Use bcrypt with at least 12 rounds, implement rate limiting, and add CORS protection"
    );

    await efrit.createCheckpoint(session, "Authentication system complete");

    // Phase 4: CRUD Operations
    console.log('📝 Phase 4: Building CRUD operations...');
    
    result = await efrit.executeNaturalLanguage(
      sessionId,
      `Implement full CRUD operations for tasks:
       - GET /api/tasks (list with pagination, filtering, sorting)
       - GET /api/tasks/:id (get single task)
       - POST /api/tasks (create new task)
       - PUT /api/tasks/:id (update task)
       - DELETE /api/tasks/:id (delete task)
       - GET /api/tasks/stats (task statistics)
       Include proper error handling, validation, and authorization checks.`
    );

    // Phase 5: Testing
    console.log('🧪 Phase 5: Adding comprehensive tests...');
    
    result = await efrit.executeNaturalLanguage(
      sessionId,
      `Create a comprehensive test suite:
       - Unit tests for all utility functions
       - Integration tests for API endpoints
       - Authentication flow tests
       - Database operation tests
       - Error handling tests
       Achieve at least 80% code coverage and include both positive and negative test cases.`
    );

    await efrit.createCheckpoint(session, "Test suite complete");

    // Phase 6: Documentation
    console.log('📚 Phase 6: Generating documentation...');
    
    result = await efrit.executeNaturalLanguage(
      sessionId,
      `Generate comprehensive documentation:
       - OpenAPI/Swagger specification for all endpoints
       - README with setup instructions
       - API usage examples
       - Database schema documentation
       - Deployment guide
       Make sure documentation is clear and includes code examples.`
    );

    // Final validation
    console.log('✅ Phase 7: Final validation and cleanup...');
    
    result = await efrit.executeNaturalLanguage(
      sessionId,
      `Perform final validation:
       - Run all tests and ensure they pass
       - Check code formatting and linting
       - Validate API endpoints work correctly
       - Generate security audit report
       - Create production build and verify it works
       Fix any issues found during validation.`
    );

    const finalStatus = efrit.getSessionStatus(sessionId);
    console.log(`\n🎉 REST API development complete!`);
    console.log(`📊 Session Stats:`);
    console.log(`   - Duration: ${Math.round(finalStatus!.duration / 1000 / 60)} minutes`);
    console.log(`   - Tools executed: ${finalStatus!.toolsExecuted}`);
    console.log(`   - Checkpoints created: ${finalStatus!.checkpoints}`);
    console.log(`   - Tasks completed: ${finalStatus!.todos.completed}/${finalStatus!.todos.total}`);

  } catch (error: unknown) {
    console.error('❌ API development failed:', error);
    
    // Show recovery options
    const session = (efrit as any).sessions.get(sessionId) as EfritSessionState;
    if (session.checkpoints.length > 0) {
      console.log('💡 Recovery options:');
      session.checkpoints.forEach((checkpoint, index) => {
        console.log(`   ${index + 1}. Restore to: ${checkpoint.description}`);
      });
    }
  }
}

/**
 * Example 2: Refactoring Legacy Code with EFRIT
 * 
 * Shows how Claude can intelligently refactor a legacy codebase
 * using EFRIT's checkpointing and safety features.
 */
export async function refactorLegacyCodeExample(): Promise<void> {
  const registry = getToolRegistry();
  const efrit = createEfritEngine(registry, './.efrit-refactor-example');

  console.log('🔧 Starting legacy code refactoring with EFRIT...');

  const sessionId = await efrit.createSession(
    "Refactor legacy JavaScript codebase to TypeScript with modern patterns, improved error handling, and comprehensive tests",
    {
      workingDirectory: './legacy-project',
      projectRoot: './legacy-project',
      safetyLevel: 'safe', // Use safe mode for refactoring
      maxToolCalls: 100
    }
  );

  // Set up event listeners for user interaction
  efrit.on('user:input-required', async ({ sessionId, prompt, options, respond }) => {
    console.log(`\n❓ User input required for session ${sessionId}:`);
    console.log(`   ${prompt}`);
    if (options) {
      console.log(`   Options: ${options.join(', ')}`);
    }
    
    // In a real application, you'd get user input here
    // For this example, we'll provide automated responses
    const response = options ? options[0] : 'yes';
    console.log(`   🤖 Auto-responding: ${response}`);
    respond(response);
  });

  try {
    // Analysis Phase
    console.log('🔍 Phase 1: Analyzing legacy codebase...');
    
    await efrit.executeNaturalLanguage(
      sessionId,
      `Analyze the legacy JavaScript codebase and create a refactoring plan:
       - Identify all .js files and their dependencies
       - Detect code smells and anti-patterns
       - Find unused code and dead functions
       - Analyze complexity and maintainability issues
       - Create a prioritized list of refactoring tasks
       - Estimate effort for each task`
    );

    // Create initial checkpoint
    const session = (efrit as any).sessions.get(sessionId) as EfritSessionState;
    await efrit.createCheckpoint(session, "Legacy codebase analyzed");

    // TypeScript Migration
    console.log('📝 Phase 2: Migrating to TypeScript...');
    
    await efrit.executeNaturalLanguage(
      sessionId,
      `Migrate JavaScript files to TypeScript:
       - Rename .js files to .ts
       - Add TypeScript configuration (tsconfig.json)
       - Define proper interfaces and types
       - Fix all TypeScript compilation errors
       - Update package.json with TypeScript dependencies
       Start with utility functions and work up to main application files.`,
      "Be conservative with types - use 'any' temporarily if needed, we'll strengthen types later"
    );

    await efrit.createCheckpoint(session, "TypeScript migration complete");

    // Modern Patterns
    console.log('🆕 Phase 3: Applying modern patterns...');
    
    await efrit.executeNaturalLanguage(
      sessionId,
      `Apply modern JavaScript/TypeScript patterns:
       - Convert var declarations to const/let
       - Replace callbacks with async/await
       - Use ES6+ features (arrow functions, destructuring, template literals)
       - Implement proper error handling with try/catch
       - Apply SOLID principles where appropriate
       - Use functional programming concepts where beneficial`
    );

    await efrit.createCheckpoint(session, "Modern patterns applied");

    // Code Quality Improvements
    console.log('✨ Phase 4: Improving code quality...');
    
    await efrit.executeNaturalLanguage(
      sessionId,
      `Improve overall code quality:
       - Add comprehensive JSDoc comments
       - Implement proper logging instead of console.log
       - Add input validation and sanitization
       - Improve error messages and error handling
       - Optimize performance bottlenecks
       - Remove duplicate code through refactoring
       - Add configuration management`
    );

    // Testing Addition
    console.log('🧪 Phase 5: Adding tests to refactored code...');
    
    await efrit.executeNaturalLanguage(
      sessionId,
      `Add comprehensive test coverage:
       - Set up Jest testing framework
       - Write unit tests for all functions
       - Add integration tests for main workflows
       - Create test data and mocks
       - Achieve at least 90% code coverage
       - Add tests for error scenarios
       - Set up automated test running in CI`
    );

    await efrit.createCheckpoint(session, "Test suite added");

    // Final Validation
    console.log('✅ Phase 6: Final validation...');
    
    await efrit.executeNaturalLanguage(
      sessionId,
      `Perform comprehensive validation of refactored code:
       - Run all tests and ensure they pass
       - Check TypeScript compilation with strict mode
       - Run linting and fix all issues
       - Verify functionality matches original behavior
       - Check performance hasn't degraded
       - Review code for any remaining issues
       - Create before/after comparison report`
    );

    const finalStatus = efrit.getSessionStatus(sessionId);
    console.log(`\n🎉 Legacy code refactoring complete!`);
    console.log(`📊 Refactoring Stats:`);
    console.log(`   - Duration: ${Math.round(finalStatus!.duration / 1000 / 60)} minutes`);
    console.log(`   - Tools executed: ${finalStatus!.toolsExecuted}`);
    console.log(`   - Checkpoints: ${finalStatus!.checkpoints}`);
    console.log(`   - Tasks: ${finalStatus!.todos.completed}/${finalStatus!.todos.total}`);

  } catch (error: unknown) {
    console.error('❌ Refactoring failed:', error);
    console.log('💡 Use checkpoints to recover from failure');
  }
}

/**
 * Example 3: Multi-Agent Swarm with EFRIT Coordination
 * 
 * Demonstrates how multiple agents can coordinate using EFRIT sessions
 * to build a complex application together.
 */
export async function multiAgentSwarmExample(): Promise<void> {
  const registry = getToolRegistry();
  const efrit = createEfritEngine(registry, './.efrit-swarm-example');

  console.log('🐝 Starting multi-agent swarm with EFRIT coordination...');

  // Create sessions for different specialist agents
  const backendSession = await efrit.createSession(
    "Build robust backend API with authentication, database integration, and comprehensive error handling",
    {
      workingDirectory: './swarm-project/backend',
      projectRoot: './swarm-project',
      safetyLevel: 'safe'
    }
  );

  const frontendSession = await efrit.createSession(
    "Build modern React frontend with TypeScript, state management, and responsive design",
    {
      workingDirectory: './swarm-project/frontend',
      projectRoot: './swarm-project',
      safetyLevel: 'safe'
    }
  );

  const testingSession = await efrit.createSession(
    "Create comprehensive test suite covering unit, integration, and end-to-end testing",
    {
      workingDirectory: './swarm-project',
      projectRoot: './swarm-project',
      safetyLevel: 'safe'
    }
  );

  const devopsSession = await efrit.createSession(
    "Set up CI/CD pipeline, containerization, and deployment infrastructure",
    {
      workingDirectory: './swarm-project',
      projectRoot: './swarm-project',
      safetyLevel: 'safe'
    }
  );

  try {
    // Phase 1: Parallel Foundation Building
    console.log('🏗️ Phase 1: Building foundations in parallel...');

    // Start all agents working simultaneously
    const foundationTasks = await Promise.allSettled([
      // Backend Agent
      efrit.executeNaturalLanguage(
        backendSession,
        `Set up Node.js backend foundation:
         - Initialize TypeScript project with Express
         - Set up database connection (PostgreSQL)
         - Create basic folder structure
         - Set up logging and configuration
         - Add health check endpoint`
      ),

      // Frontend Agent  
      efrit.executeNaturalLanguage(
        frontendSession,
        `Set up React frontend foundation:
         - Create React app with TypeScript
         - Set up state management (Redux Toolkit)
         - Configure routing (React Router)
         - Set up styling framework (Tailwind CSS)
         - Create basic component structure`
      ),

      // Testing Agent
      efrit.executeNaturalLanguage(
        testingSession,
        `Set up testing infrastructure:
         - Configure Jest for unit testing
         - Set up Cypress for E2E testing
         - Create test utilities and helpers
         - Set up test database
         - Configure coverage reporting`
      ),

      // DevOps Agent
      efrit.executeNaturalLanguage(
        devopsSession,
        `Set up DevOps foundation:
         - Create Dockerfile for backend and frontend
         - Set up docker-compose for local development
         - Initialize GitHub Actions workflows
         - Configure environment management
         - Set up monitoring and logging`
      )
    ]);

    // Check if any foundation task failed
    foundationTasks.forEach((task, index) => {
      const sessionNames = ['Backend', 'Frontend', 'Testing', 'DevOps'];
      if (task.status === 'rejected') {
        console.warn(`⚠️ ${sessionNames[index]} foundation task failed:`, task.reason);
      } else {
        console.log(`✅ ${sessionNames[index]} foundation complete`);
      }
    });

    // Phase 2: Core Feature Development (Sequential with coordination)
    console.log('🔧 Phase 2: Building core features with coordination...');

    // Backend builds API first
    await efrit.executeNaturalLanguage(
      backendSession,
      `Build core API endpoints:
       - User authentication (register, login, logout)
       - User profile management
       - CRUD operations for main entities
       - Input validation and error handling
       - API documentation with Swagger`
    );

    // Update todo to signal API is ready
    await efrit.updateTodoList(backendSession, [{
      description: "Core API endpoints completed",
      status: "completed",
      priority: "high"
    }]);

    // Frontend can now integrate with API
    await efrit.executeNaturalLanguage(
      frontendSession,
      `Build frontend features to integrate with backend API:
       - Authentication pages (login, register)
       - Dashboard with main functionality
       - Forms for CRUD operations
       - Error handling and loading states
       - Responsive design for mobile`,
      "Backend API is now available - integrate with the authentication and CRUD endpoints"
    );

    // Testing agent creates tests for completed features
    await efrit.executeNaturalLanguage(
      testingSession,
      `Create tests for completed features:
       - API endpoint tests
       - Authentication flow tests
       - Frontend component tests
       - Integration tests between frontend and backend
       - Performance and load tests`
    );

    // Phase 3: Advanced Features and Polish
    console.log('✨ Phase 3: Adding advanced features...');

    await Promise.allSettled([
      // Backend advanced features
      efrit.executeNaturalLanguage(
        backendSession,
        `Add advanced backend features:
         - Real-time notifications with WebSockets
         - File upload handling
         - Email notifications
         - Advanced search and filtering
         - Caching layer with Redis`
      ),

      // Frontend polish
      efrit.executeNaturalLanguage(
        frontendSession,
        `Polish frontend experience:
         - Add real-time updates
         - Implement advanced UI components
         - Add animations and transitions
         - Optimize performance
         - Add accessibility features`
      )
    ]);

    // Phase 4: Final Integration and Deployment
    console.log('🚀 Phase 4: Final integration and deployment...');

    // DevOps sets up deployment
    await efrit.executeNaturalLanguage(
      devopsSession,
      `Prepare for production deployment:
       - Set up production environment configuration
       - Configure CI/CD pipeline for automated deployment
       - Set up monitoring and alerting
       - Create backup and recovery procedures
       - Perform security audit and hardening`
    );

    // Final testing sweep
    await efrit.executeNaturalLanguage(
      testingSession,
      `Perform comprehensive final testing:
       - Run full test suite
       - Perform security testing
       - Load testing and performance validation
       - Cross-browser and device testing
       - User acceptance testing scenarios`
    );

    // Generate final reports
    const sessions = [
      { name: 'Backend', id: backendSession },
      { name: 'Frontend', id: frontendSession },
      { name: 'Testing', id: testingSession },
      { name: 'DevOps', id: devopsSession }
    ];

    console.log(`\n🎉 Multi-agent swarm development complete!`);
    console.log(`📊 Swarm Statistics:`);
    
    let totalDuration = 0;
    let totalTools = 0;
    let totalTodos = 0;
    let completedTodos = 0;

    for (const session of sessions) {
      const status = efrit.getSessionStatus(session.id);
      if (status) {
        totalDuration = Math.max(totalDuration, status.duration);
        totalTools += status.toolsExecuted;
        totalTodos += status.todos.total;
        completedTodos += status.todos.completed;
        
        console.log(`   ${session.name}:`);
        console.log(`     - Tools executed: ${status.toolsExecuted}`);
        console.log(`     - Tasks: ${status.todos.completed}/${status.todos.total}`);
        console.log(`     - Checkpoints: ${status.checkpoints}`);
      }
    }

    console.log(`\n   📈 Overall:`);
    console.log(`     - Total duration: ${Math.round(totalDuration / 1000 / 60)} minutes`);
    console.log(`     - Total tools executed: ${totalTools}`);
    console.log(`     - Total tasks completed: ${completedTodos}/${totalTodos}`);
    console.log(`     - Success rate: ${Math.round((completedTodos / totalTodos) * 100)}%`);

  } catch (error: unknown) {
    console.error('❌ Multi-agent swarm failed:', error);
    console.log('💡 Check individual agent sessions for recovery options');
  }
}

/**
 * Example 4: Interactive Development Session
 * 
 * Shows how users can guide Claude through complex development tasks
 * with real-time feedback and course correction.
 */
export async function interactiveDevelopmentExample(): Promise<void> {
  const registry = getToolRegistry();
  const efrit = createEfritEngine(registry, './.efrit-interactive-example');

  console.log('💬 Starting interactive development session...');

  const sessionId = await efrit.createSession(
    "Build a custom component library for our design system",
    {
      workingDirectory: './component-library',
      projectRoot: './component-library',
      safetyLevel: 'safe'
    }
  );

  // Set up interactive event handlers
  efrit.on('user:input-required', ({ sessionId, prompt, options, respond }) => {
    console.log(`\n💡 Claude needs guidance:`);
    console.log(`   ${prompt}`);
    
    if (options) {
      console.log(`   Options: ${options.join(', ')}`);
    }
    
    // Simulate user responses for different scenarios
    if (prompt.includes('component framework')) {
      respond('React with TypeScript');
    } else if (prompt.includes('styling approach')) {
      respond('Styled Components with theme support');
    } else if (prompt.includes('testing strategy')) {
      respond('Jest with React Testing Library and Storybook');
    } else {
      respond('Continue with your best judgment');
    }
  });

  efrit.on('checkpoint:created', ({ sessionId, checkpoint }) => {
    console.log(`📍 Checkpoint created: ${checkpoint.description}`);
  });

  efrit.on('todos:updated', ({ sessionId, todos }) => {
    // @ts-expect-error - Post-Merge Reconciliation
    const pending = todos.filter(t => t.status === 'pending').length;
    // @ts-expect-error - Post-Merge Reconciliation
    const completed = todos.filter(t => t.status === 'completed').length;
    console.log(`📋 Todo update: ${completed} completed, ${pending} pending`);
  });

  try {
    // Start interactive development
    let result = await efrit.executeNaturalLanguage(
      sessionId,
      `I want to create a component library for our design system. 
       Ask me about preferences for framework, styling, testing, and other key decisions.
       Then build the library based on my guidance.`
    );

    // Provide mid-session guidance
    await efrit.executeNaturalLanguage(
      sessionId,
      "Continue building the component library",
      `Focus on these priority components first:
       1. Button (primary, secondary, ghost variants)
       2. Input (text, email, password with validation)
       3. Modal (with backdrop and animation)
       4. Toast notifications
       Make sure each component is fully typed and has proper accessibility.`
    );

    // Add more guidance as development progresses
    await efrit.executeNaturalLanguage(
      sessionId,
      "Now add documentation and examples",
      `Create comprehensive Storybook stories for each component showing:
       - All variants and states
       - Interactive examples
       - Code snippets for usage
       - Accessibility guidelines
       Also generate a README with installation and usage instructions.`
    );

    const finalStatus = efrit.getSessionStatus(sessionId);
    console.log(`\n🎉 Interactive development session complete!`);
    console.log(`📊 Session Stats:`);
    console.log(`   - Duration: ${Math.round(finalStatus!.duration / 1000 / 60)} minutes`);
    console.log(`   - Tools executed: ${finalStatus!.toolsExecuted}`);
    console.log(`   - User interactions: ${finalStatus!.todos.total}`);

  } catch (error: unknown) {
    console.error('❌ Interactive session failed:', error);
  }
}

// Export utility function to run examples
export async function runEfritExamples(exampleName?: string): Promise<void> {
  const examples = {
    'rest-api': buildRestApiExample,
    'refactor': refactorLegacyCodeExample,
    'multi-agent': multiAgentSwarmExample,
    'interactive': interactiveDevelopmentExample
  };

  if (exampleName && examples[exampleName as keyof typeof examples]) {
    await examples[exampleName as keyof typeof examples]();
  } else if (!exampleName) {
    console.log('🚀 Running all EFRIT examples...\n');
    for (const [name, example] of Object.entries(examples)) {
      console.log(`\n${'='.repeat(60)}`);
      console.log(`Running example: ${name}`);
      console.log('='.repeat(60));
      try {
        await example();
      } catch (error: unknown) {
        console.error(`Example ${name} failed:`, error);
      }
    }
  } else {
    console.log('Available examples:');
    Object.keys(examples).forEach(name => {
      console.log(`  - ${name}`);
    });
  }
}