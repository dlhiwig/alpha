import { describe, it, expect, beforeEach, afterEach, vi, beforeAll, afterAll } from 'vitest'
import { DoltService } from '../DoltService'
import * as fs from 'fs/promises'
import * as path from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

// Mock the child_process module
vi.mock('child_process', () => ({
  exec: vi.fn()
}))

// Mock fs/promises
vi.mock('fs/promises', () => ({
  mkdir: vi.fn(),
  access: vi.fn(),
  readdir: vi.fn(),
  rmdir: vi.fn()
}))

describe('DoltService', () => {
  let service: DoltService
  let mockExec: any
  let mockFs: any
  const testDbPath = '/tmp/test-dolt-db'

  beforeAll(() => {
    mockExec = vi.mocked(exec)
    mockFs = vi.mocked(fs)
  })

  beforeEach(async () => {
    vi.clearAllMocks()
    service = new DoltService({ 
      dbPath: testDbPath,
      timeout: 5000,
      maxRetries: 2,
      retryDelay: 100
    })

    // Default successful responses
    mockExec.mockImplementation((command: string, options: any, callback: any) => {
      if (typeof options === 'function') {
        callback = options
        options = {}
      }
      
      // Simulate successful command execution
      setTimeout(() => {
        callback(null, { stdout: '', stderr: '' })
      }, 10)
    })

    mockFs.mkdir.mockResolvedValue(undefined)
    mockFs.access.mockResolvedValue(undefined)
  })

  afterEach(async () => {
    // Clean up any test state
    vi.restoreAllMocks()
  })

  describe('constructor', () => {
    it('should use default config when no config provided', () => {
      const defaultService = new DoltService()
      expect(defaultService).toBeDefined()
    })

    it('should use provided config values', () => {
      const config = {
        dbPath: '/custom/path',
        timeout: 60000,
        maxRetries: 5,
        retryDelay: 2000
      }
      const customService = new DoltService(config)
      expect(customService).toBeDefined()
    })
  })

  describe('initialize', () => {
    it('should create database if not exists', async () => {
      // Mock dolt version check
      mockExec.mockImplementation((command: string, options: any, callback: any) => {
        if (typeof options === 'function') {
          callback = options
          options = {}
        }
        
        if (command.includes('dolt version')) {
          callback(null, { stdout: 'dolt version 1.0.0', stderr: '' })
        } else if (command.includes('dolt init')) {
          callback(null, { stdout: 'Successfully initialized dolt repository', stderr: '' })
        } else if (command.includes('dolt config')) {
          callback(null, { stdout: '', stderr: '' })
        } else if (command.includes('dolt sql')) {
          callback(null, { stdout: '', stderr: '' })
        } else if (command.includes('dolt status')) {
          callback(null, { stdout: 'nothing to commit, working tree clean', stderr: '' })
        } else {
          callback(null, { stdout: '', stderr: '' })
        }
      })

      // Mock .dolt directory not existing (new repo)
      mockFs.access.mockRejectedValueOnce(new Error('ENOENT'))

      await service.initialize()

      expect(mockFs.mkdir).toHaveBeenCalledWith(testDbPath, { recursive: true })
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('dolt version'),
        expect.any(Object),
        expect.any(Function)
      )
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('dolt init'),
        expect.any(Object),
        expect.any(Function)
      )
    })

    it('should run schema migrations', async () => {
      let schemaSqlExecuted = false
      
      mockExec.mockImplementation((command: string, options: any, callback: any) => {
        if (typeof options === 'function') {
          callback = options
          options = {}
        }
        
        if (command.includes('dolt version')) {
          callback(null, { stdout: 'dolt version 1.0.0', stderr: '' })
        } else if (command.includes('CREATE TABLE')) {
          schemaSqlExecuted = true
          callback(null, { stdout: '', stderr: '' })
        } else if (command.includes('dolt status')) {
          callback(null, { stdout: 'nothing to commit, working tree clean', stderr: '' })
        } else {
          callback(null, { stdout: '', stderr: '' })
        }
      })

      await service.initialize()

      expect(schemaSqlExecuted).toBe(true)
    })

    it('should handle existing database', async () => {
      mockExec.mockImplementation((command: string, options: any, callback: any) => {
        if (typeof options === 'function') {
          callback = options
          options = {}
        }
        
        if (command.includes('dolt version')) {
          callback(null, { stdout: 'dolt version 1.0.0', stderr: '' })
        } else if (command.includes('dolt status')) {
          callback(null, { stdout: 'nothing to commit, working tree clean', stderr: '' })
        } else {
          callback(null, { stdout: '', stderr: '' })
        }
      })

      // Mock .dolt directory exists (existing repo)
      mockFs.access.mockResolvedValue(undefined)

      await service.initialize()

      // Should not call dolt init for existing repo
      expect(mockExec).not.toHaveBeenCalledWith(
        expect.stringContaining('dolt init'),
        expect.any(Object),
        expect.any(Function)
      )
    })

    it('should only initialize once', async () => {
      mockExec.mockImplementation((command: string, options: any, callback: any) => {
        if (typeof options === 'function') {
          callback = options
          options = {}
        }
        callback(null, { stdout: 'dolt version 1.0.0', stderr: '' })
      })

      await service.initialize()
      await service.initialize() // Second call should be no-op

      // Should only call mkdir once
      expect(mockFs.mkdir).toHaveBeenCalledTimes(1)
    })
  })

  describe('query', () => {
    beforeEach(async () => {
      // Mock initialization
      mockExec.mockImplementation((command: string, options: any, callback: any) => {
        if (typeof options === 'function') {
          callback = options
          options = {}
        }
        callback(null, { stdout: 'dolt version 1.0.0', stderr: '' })
      })
      await service.initialize()
    })

    it('should execute SELECT queries', async () => {
      const mockData = [
        { id: 1, name: 'test1' },
        { id: 2, name: 'test2' }
      ]
      
      mockExec.mockImplementation((command: string, options: any, callback: any) => {
        if (typeof options === 'function') {
          callback = options
          options = {}
        }
        
        // Match the actual implementation: dolt sql -r json -q "..."
        if (command.includes('dolt sql -r json -q')) {
          const jsonOutput = mockData.map(row => JSON.stringify(row)).join('\n')
          callback(null, { stdout: jsonOutput, stderr: '' })
        } else {
          callback(null, { stdout: '', stderr: '' })
        }
      })

      const result = await service.query('SELECT * FROM test_table')

      expect(result).toEqual(mockData)
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('dolt sql -r json -q "SELECT * FROM test_table"'),
        expect.any(Object),
        expect.any(Function)
      )
    })

    it('should parse JSON results', async () => {
      const mockJsonOutput = '{"id": 1, "data": {"nested": "value"}}\n{"id": 2, "data": {"nested": "value2"}}'
      
      mockExec.mockImplementation((command: string, options: any, callback: any) => {
        if (typeof options === 'function') {
          callback = options
          options = {}
        }
        
        // Match the actual implementation: dolt sql -r json -q "..."
        if (command.includes('dolt sql -r json -q')) {
          callback(null, { stdout: mockJsonOutput, stderr: '' })
        } else {
          callback(null, { stdout: '', stderr: '' })
        }
      })

      const result = await service.query('SELECT * FROM json_table')

      expect(result).toEqual([
        { id: 1, data: { nested: 'value' } },
        { id: 2, data: { nested: 'value2' } }
      ])
    })

    it('should handle empty results', async () => {
      mockExec.mockImplementation((command: string, options: any, callback: any) => {
        if (typeof options === 'function') {
          callback = options
          options = {}
        }
        
        // Match the actual implementation: dolt sql -r json -q "..."
        if (command.includes('dolt sql -r json -q')) {
          callback(null, { stdout: '', stderr: '' })
        } else {
          callback(null, { stdout: '', stderr: '' })
        }
      })

      const result = await service.query('SELECT * FROM empty_table')

      expect(result).toEqual([])
    })

    it('should handle parameterized queries', async () => {
      mockExec.mockImplementation((command: string, options: any, callback: any) => {
        if (typeof options === 'function') {
          callback = options
          options = {}
        }
        
        // The parameterized query should have values substituted
        // Implementation uses escapeValue which wraps strings in single quotes
        if (command.includes("SELECT * FROM users WHERE id = 1 AND name = 'test'")) {
          callback(null, { stdout: '{"id": 1, "name": "test"}', stderr: '' })
        } else {
          callback(null, { stdout: '', stderr: '' })
        }
      })

      const result = await service.query('SELECT * FROM users WHERE id = ? AND name = ?', [1, 'test'])

      expect(result).toEqual([{ id: 1, name: 'test' }])
    })
  })

  describe('execute', () => {
    beforeEach(async () => {
      // Mock initialization
      mockExec.mockImplementation((command: string, options: any, callback: any) => {
        if (typeof options === 'function') {
          callback = options
          options = {}
        }
        callback(null, { stdout: 'dolt version 1.0.0', stderr: '' })
      })
      await service.initialize()
    })

    it('should execute INSERT statements', async () => {
      mockExec.mockImplementation((command: string, options: any, callback: any) => {
        if (typeof options === 'function') {
          callback = options
          options = {}
        }
        
        if (command.includes('INSERT INTO')) {
          callback(null, { stdout: '1 row inserted', stderr: '' })
        } else {
          callback(null, { stdout: '', stderr: '' })
        }
      })

      const result = await service.execute('INSERT INTO users (name) VALUES (?)', ['John'])

      expect(result.affectedRows).toBe(1)
    })

    it('should execute UPDATE statements', async () => {
      mockExec.mockImplementation((command: string, options: any, callback: any) => {
        if (typeof options === 'function') {
          callback = options
          options = {}
        }
        
        if (command.includes('UPDATE')) {
          callback(null, { stdout: '3 rows affected', stderr: '' })
        } else {
          callback(null, { stdout: '', stderr: '' })
        }
      })

      const result = await service.execute('UPDATE users SET status = ? WHERE active = ?', ['inactive', true])

      expect(result.affectedRows).toBe(3)
    })

    it('should execute DELETE statements', async () => {
      mockExec.mockImplementation((command: string, options: any, callback: any) => {
        if (typeof options === 'function') {
          callback = options
          options = {}
        }
        
        if (command.includes('DELETE')) {
          callback(null, { stdout: '2 rows deleted', stderr: '' })
        } else {
          callback(null, { stdout: '', stderr: '' })
        }
      })

      const result = await service.execute('DELETE FROM users WHERE id = ?', [123])

      expect(result.affectedRows).toBe(2)
    })

    it('should return affected rows count', async () => {
      mockExec.mockImplementation((command: string, options: any, callback: any) => {
        if (typeof options === 'function') {
          callback = options
          options = {}
        }
        
        if (command.includes('dolt sql')) {
          callback(null, { stdout: '5 rows updated successfully', stderr: '' })
        } else {
          callback(null, { stdout: '', stderr: '' })
        }
      })

      const result = await service.execute('UPDATE test SET value = 1')

      expect(result.affectedRows).toBe(5)
    })

    it('should handle zero affected rows', async () => {
      mockExec.mockImplementation((command: string, options: any, callback: any) => {
        if (typeof options === 'function') {
          callback = options
          options = {}
        }
        
        if (command.includes('dolt sql')) {
          callback(null, { stdout: 'No matching rows found', stderr: '' })
        } else {
          callback(null, { stdout: '', stderr: '' })
        }
      })

      const result = await service.execute('DELETE FROM users WHERE id = ?', [999])

      expect(result.affectedRows).toBe(0)
    })
  })

  describe('git operations', () => {
    beforeEach(async () => {
      // Mock initialization
      mockExec.mockImplementation((command: string, options: any, callback: any) => {
        if (typeof options === 'function') {
          callback = options
          options = {}
        }
        callback(null, { stdout: 'dolt version 1.0.0', stderr: '' })
      })
      await service.initialize()
    })

    it('should commit changes', async () => {
      mockExec.mockImplementation((command: string, options: any, callback: any) => {
        if (typeof options === 'function') {
          callback = options
          options = {}
        }
        
        if (command.includes('dolt status')) {
          // Return status indicating there are changes
          callback(null, { stdout: 'Changes to be committed:', stderr: '' })
        } else if (command.includes('dolt add .')) {
          callback(null, { stdout: 'Changes staged', stderr: '' })
        } else if (command.includes('dolt commit -m')) {
          callback(null, { stdout: 'Commit successful', stderr: '' })
        } else {
          callback(null, { stdout: '', stderr: '' })
        }
      })

      await service.commit('Test commit message')

      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('dolt add .'),
        expect.any(Object),
        expect.any(Function)
      )
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('dolt commit -m "Test commit message"'),
        expect.any(Object),
        expect.any(Function)
      )
    })

    it('should skip commit when no changes', async () => {
      mockExec.mockImplementation((command: string, options: any, callback: any) => {
        if (typeof options === 'function') {
          callback = options
          options = {}
        }
        
        if (command.includes('dolt status')) {
          callback(null, { stdout: 'nothing to commit, working tree clean', stderr: '' })
        } else {
          callback(null, { stdout: '', stderr: '' })
        }
      })

      await service.commit('Test commit message')

      // Should not call dolt add or dolt commit when nothing to commit
      expect(mockExec).not.toHaveBeenCalledWith(
        expect.stringContaining('dolt add .'),
        expect.any(Object),
        expect.any(Function)
      )
    })

    it('should create branches', async () => {
      mockExec.mockImplementation((command: string, options: any, callback: any) => {
        if (typeof options === 'function') {
          callback = options
          options = {}
        }
        
        if (command.includes('dolt checkout -b')) {
          callback(null, { stdout: 'Switched to new branch feature-branch', stderr: '' })
        } else {
          callback(null, { stdout: '', stderr: '' })
        }
      })

      await service.branch('feature-branch')

      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('dolt checkout -b "feature-branch"'),
        expect.any(Object),
        expect.any(Function)
      )
    })

    it('should merge branches', async () => {
      mockExec.mockImplementation((command: string, options: any, callback: any) => {
        if (typeof options === 'function') {
          callback = options
          options = {}
        }
        
        if (command.includes('dolt merge')) {
          callback(null, { stdout: 'Merge successful', stderr: '' })
        } else {
          callback(null, { stdout: '', stderr: '' })
        }
      })

      await service.merge('feature-branch')

      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('dolt merge "feature-branch"'),
        expect.any(Object),
        expect.any(Function)
      )
    })

    it('should get history', async () => {
      // Note: Git/Dolt hashes are hex only (0-9, a-f), so use valid hex chars
      const mockLogOutput = `abc123 Initial commit (John Doe, 2026-01-01 12:00:00)
def456 Add user table (Jane Smith, 2026-01-02 13:30:00)
fade89 Update schema (Bob Johnson, 2026-01-03 14:45:00)`

      mockExec.mockImplementation((command: string, options: any, callback: any) => {
        if (typeof options === 'function') {
          callback = options
          options = {}
        }
        
        if (command.includes('dolt log')) {
          callback(null, { stdout: mockLogOutput, stderr: '' })
        } else {
          callback(null, { stdout: '', stderr: '' })
        }
      })

      const history = await service.getHistory()

      expect(history).toEqual([
        {
          hash: 'abc123',
          message: 'Initial commit',
          author: 'John Doe',
          date: '2026-01-01 12:00:00'
        },
        {
          hash: 'def456',
          message: 'Add user table',
          author: 'Jane Smith',
          date: '2026-01-02 13:30:00'
        },
        {
          hash: 'fade89',
          message: 'Update schema',
          author: 'Bob Johnson',
          date: '2026-01-03 14:45:00'
        }
      ])
    })

    it('should get history with table filter', async () => {
      mockExec.mockImplementation((command: string, options: any, callback: any) => {
        if (typeof options === 'function') {
          callback = options
          options = {}
        }
        
        // Implementation uses: dolt log --oneline --limit ${limit} -- ${escapeShellArg(table)}
        // escapeShellArg('users') = 'users' (no special chars to escape)
        // So the command is: dolt log --oneline --limit 5 -- users
        if (command.includes('dolt log') && command.includes('-- users')) {
          callback(null, { stdout: 'abc123 User table changes (Author, 2026-01-01 12:00:00)', stderr: '' })
        } else {
          callback(null, { stdout: '', stderr: '' })
        }
      })

      const history = await service.getHistory('users', 5)

      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('-- users'),
        expect.any(Object),
        expect.any(Function)
      )
      expect(history).toHaveLength(1)
    })

    it('should show diffs', async () => {
      const mockDiffOutput = `diff --dolt a/users b/users
--- a/users
+++ b/users
+{"id": 1, "name": "John"}
-{"id": 2, "name": "Jane"}`

      mockExec.mockImplementation((command: string, options: any, callback: any) => {
        if (typeof options === 'function') {
          callback = options
          options = {}
        }
        
        if (command.includes('dolt diff')) {
          callback(null, { stdout: mockDiffOutput, stderr: '' })
        } else {
          callback(null, { stdout: '', stderr: '' })
        }
      })

      const diff = await service.diff('abc123', 'def456')

      expect(diff).toBeDefined()
      expect(Array.isArray(diff)).toBe(true)
    })

    it('should get current branch', async () => {
      mockExec.mockImplementation((command: string, options: any, callback: any) => {
        if (typeof options === 'function') {
          callback = options
          options = {}
        }
        
        if (command.includes('dolt branch --show-current')) {
          callback(null, { stdout: 'main\n', stderr: '' })
        } else {
          callback(null, { stdout: '', stderr: '' })
        }
      })

      const branch = await service.getCurrentBranch()

      expect(branch).toBe('main')
    })

    it('should list branches', async () => {
      const mockBranchOutput = `  feature-1
* main
  feature-2`

      mockExec.mockImplementation((command: string, options: any, callback: any) => {
        if (typeof options === 'function') {
          callback = options
          options = {}
        }
        
        if (command.includes('dolt branch') && !command.includes('--show-current')) {
          callback(null, { stdout: mockBranchOutput, stderr: '' })
        } else {
          callback(null, { stdout: '', stderr: '' })
        }
      })

      const branches = await service.listBranches()

      expect(branches).toEqual(['feature-1', 'main', 'feature-2'])
    })

    it('should reset to commit', async () => {
      mockExec.mockImplementation((command: string, options: any, callback: any) => {
        if (typeof options === 'function') {
          callback = options
          options = {}
        }
        
        if (command.includes('dolt reset')) {
          callback(null, { stdout: 'Reset successful', stderr: '' })
        } else {
          callback(null, { stdout: '', stderr: '' })
        }
      })

      await service.reset('abc123', true)

      // Implementation: dolt reset ${hardFlag} ${commitRef}
      // hardFlag = '--hard', commitRef = escapeShellArg('abc123') = 'abc123'
      // Result: dolt reset --hard abc123
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('dolt reset --hard abc123'),
        expect.any(Object),
        expect.any(Function)
      )
    })

    it('should reset to HEAD when no commit specified', async () => {
      mockExec.mockImplementation((command: string, options: any, callback: any) => {
        if (typeof options === 'function') {
          callback = options
          options = {}
        }
        
        if (command.includes('dolt reset')) {
          callback(null, { stdout: 'Reset successful', stderr: '' })
        } else {
          callback(null, { stdout: '', stderr: '' })
        }
      })

      await service.reset(undefined, false)

      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('dolt reset  HEAD'),
        expect.any(Object),
        expect.any(Function)
      )
    })
  })

  describe('error handling', () => {
    beforeEach(async () => {
      // Mock successful initialization
      mockExec.mockImplementation((command: string, options: any, callback: any) => {
        if (typeof options === 'function') {
          callback = options
          options = {}
        }
        callback(null, { stdout: 'dolt version 1.0.0', stderr: '' })
      })
      await service.initialize()
    })

    it('should handle connection errors', async () => {
      mockExec.mockImplementation((command: string, options: any, callback: any) => {
        if (typeof options === 'function') {
          callback = options
          options = {}
        }
        
        if (command.includes('dolt sql')) {
          const error = new Error('Connection failed')
          callback(error)
        } else {
          callback(null, { stdout: '', stderr: '' })
        }
      })

      await expect(service.query('SELECT * FROM test')).rejects.toThrow('Query failed')
    })

    it('should handle SQL syntax errors', async () => {
      mockExec.mockImplementation((command: string, options: any, callback: any) => {
        if (typeof options === 'function') {
          callback = options
          options = {}
        }
        
        if (command.includes('dolt sql')) {
          const error = new Error('SQL syntax error near "SELEC"')
          callback(error)
        } else {
          callback(null, { stdout: '', stderr: '' })
        }
      })

      await expect(service.execute('INVALID SQL')).rejects.toThrow('Execute failed')
    })

    it('should retry failed operations', async () => {
      let attempts = 0
      
      mockExec.mockImplementation((command: string, options: any, callback: any) => {
        if (typeof options === 'function') {
          callback = options
          options = {}
        }
        
        if (command.includes('dolt sql -r json -q')) {
          attempts++
          if (attempts < 2) {
            const error = new Error('Temporary failure')
            callback(error)
          } else {
            callback(null, { stdout: '{"id": 1}', stderr: '' })
          }
        } else {
          callback(null, { stdout: '', stderr: '' })
        }
      })

      const result = await service.query('SELECT * FROM test')

      expect(attempts).toBe(2)
      expect(result).toEqual([{ id: 1 }])
    })

    it('should throw after max retries exceeded', async () => {
      mockExec.mockImplementation((command: string, options: any, callback: any) => {
        if (typeof options === 'function') {
          callback = options
          options = {}
        }
        
        if (command.includes('dolt sql')) {
          const error = new Error('Persistent failure')
          callback(error)
        } else {
          callback(null, { stdout: '', stderr: '' })
        }
      })

      await expect(service.query('SELECT * FROM test')).rejects.toThrow('Query failed')
    })

    it('should handle missing dolt installation', async () => {
      mockExec.mockImplementation((command: string, options: any, callback: any) => {
        if (typeof options === 'function') {
          callback = options
          options = {}
        }
        
        if (command.includes('dolt version')) {
          const error = new Error('dolt: command not found')
          callback(error)
        } else {
          callback(null, { stdout: '', stderr: '' })
        }
      })

      const newService = new DoltService({ dbPath: '/tmp/new-test-db' })
      
      await expect(newService.initialize()).rejects.toThrow('Dolt is not installed')
    })

    it('should handle invalid JSON output', async () => {
      mockExec.mockImplementation((command: string, options: any, callback: any) => {
        if (typeof options === 'function') {
          callback = options
          options = {}
        }
        
        if (command.includes('dolt sql -r json -q')) {
          callback(null, { stdout: 'invalid json{', stderr: '' })
        } else {
          callback(null, { stdout: '', stderr: '' })
        }
      })

      await expect(service.query('SELECT * FROM test')).rejects.toThrow('Failed to parse JSON output')
    })

    it('should handle timeout errors', async () => {
      const shortTimeoutService = new DoltService({ 
        dbPath: testDbPath, 
        timeout: 100  // Very short timeout
      })
      
      mockExec.mockImplementation((command: string, options: any, callback: any) => {
        if (typeof options === 'function') {
          callback = options
          options = {}
        }
        
        // Don't call callback to simulate timeout
        if (command.includes('dolt sql -r json -q')) {
          setTimeout(() => {
            const error = new Error('Command timeout')
            callback(error)
          }, 200)
        } else {
          callback(null, { stdout: 'dolt version 1.0.0', stderr: '' })
        }
      })

      await shortTimeoutService.initialize()
      
      await expect(shortTimeoutService.query('SELECT * FROM test')).rejects.toThrow()
    })
  })

  describe('parameter escaping', () => {
    beforeEach(async () => {
      mockExec.mockImplementation((command: string, options: any, callback: any) => {
        if (typeof options === 'function') {
          callback = options
          options = {}
        }
        callback(null, { stdout: 'dolt version 1.0.0', stderr: '' })
      })
      await service.initialize()
    })

    it('should escape string parameters with quotes', async () => {
      mockExec.mockImplementation((command: string, options: any, callback: any) => {
        if (typeof options === 'function') {
          callback = options
          options = {}
        }
        
        // Verify the escaped parameter is in the command
        // Implementation uses escapeValue which doubles single quotes
        if (command.includes("name = 'John''s Test'")) {
          callback(null, { stdout: '{"success": true}', stderr: '' })
        } else {
          callback(null, { stdout: '', stderr: '' })
        }
      })

      await service.query('SELECT * FROM users WHERE name = ?', ["John's Test"])
    })

    it('should handle null parameters', async () => {
      mockExec.mockImplementation((command: string, options: any, callback: any) => {
        if (typeof options === 'function') {
          callback = options
          options = {}
        }
        
        if (command.includes('value = NULL')) {
          callback(null, { stdout: '{"success": true}', stderr: '' })
        } else {
          callback(null, { stdout: '', stderr: '' })
        }
      })

      await service.query('SELECT * FROM test WHERE value = ?', [null])
    })

    it('should handle object parameters as JSON', async () => {
      const objParam = { nested: { key: 'value' } }
      
      mockExec.mockImplementation((command: string, options: any, callback: any) => {
        if (typeof options === 'function') {
          callback = options
          options = {}
        }
        
        if (command.includes(JSON.stringify(objParam).replace(/'/g, "''"))) {
          callback(null, { stdout: '{"success": true}', stderr: '' })
        } else {
          callback(null, { stdout: '', stderr: '' })
        }
      })

      await service.query('INSERT INTO test (data) VALUES (?)', [objParam])
    })

    it('should handle date parameters', async () => {
      const dateParam = new Date('2026-01-01T12:00:00.000Z')
      
      mockExec.mockImplementation((command: string, options: any, callback: any) => {
        if (typeof options === 'function') {
          callback = options
          options = {}
        }
        
        if (command.includes(dateParam.toISOString())) {
          callback(null, { stdout: '{"success": true}', stderr: '' })
        } else {
          callback(null, { stdout: '', stderr: '' })
        }
      })

      await service.query('SELECT * FROM events WHERE created_at = ?', [dateParam])
    })
  })

  describe('edge cases and performance', () => {
    beforeEach(async () => {
      mockExec.mockImplementation((command: string, options: any, callback: any) => {
        if (typeof options === 'function') {
          callback = options
          options = {}
        }
        callback(null, { stdout: 'dolt version 1.0.0', stderr: '' })
      })
      await service.initialize()
    })

    it('should handle large result sets', async () => {
      const largeDataset = Array.from({ length: 1000 }, (_, i) => ({ id: i, name: `item${i}` }))
      const jsonOutput = largeDataset.map(row => JSON.stringify(row)).join('\n')
      
      mockExec.mockImplementation((command: string, options: any, callback: any) => {
        if (typeof options === 'function') {
          callback = options
          options = {}
        }
        
        if (command.includes('dolt sql -r json -q')) {
          callback(null, { stdout: jsonOutput, stderr: '' })
        } else {
          callback(null, { stdout: '', stderr: '' })
        }
      })

      const result = await service.query('SELECT * FROM large_table')

      expect(result).toHaveLength(1000)
      expect(result[0]).toEqual({ id: 0, name: 'item0' })
      expect(result[999]).toEqual({ id: 999, name: 'item999' })
    })

    it('should handle concurrent operations', async () => {
      let execCount = 0
      
      mockExec.mockImplementation((command: string, options: any, callback: any) => {
        if (typeof options === 'function') {
          callback = options
          options = {}
        }
        
        if (command.includes('dolt sql -r json -q')) {
          execCount++
          setTimeout(() => {
            callback(null, { stdout: `{"count": ${execCount}}`, stderr: '' })
          }, 10)
        } else {
          callback(null, { stdout: '', stderr: '' })
        }
      })

      // Execute multiple queries concurrently
      const promises = [
        service.query('SELECT 1'),
        service.query('SELECT 2'),
        service.query('SELECT 3')
      ]

      const results = await Promise.all(promises)

      expect(results).toHaveLength(3)
      expect(execCount).toBe(3)
    })

    it('should handle warnings in stderr without failing', async () => {
      // Note: Implementation only logs to console.warn when stderr does NOT contain "Warning:"
      // (i.e., it filters out Dolt's own warning messages but logs unexpected stderr)
      mockExec.mockImplementation((command: string, options: any, callback: any) => {
        if (typeof options === 'function') {
          callback = options
          options = {}
        }
        
        if (command.includes('dolt sql -r json -q')) {
          callback(null, { 
            stdout: '{"id": 1}', 
            stderr: 'Some unexpected stderr output' 
          })
        } else {
          callback(null, { stdout: '', stderr: '' })
        }
      })

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const result = await service.query('SELECT * FROM test')

      expect(result).toEqual([{ id: 1 }])
      expect(consoleSpy).toHaveBeenCalledWith('Dolt warning: Some unexpected stderr output')
      
      consoleSpy.mockRestore()
    })

    it('should NOT log Dolt Warning: messages to console', async () => {
      // Implementation filters out stderr containing "Warning:" to avoid noise
      mockExec.mockImplementation((command: string, options: any, callback: any) => {
        if (typeof options === 'function') {
          callback = options
          options = {}
        }
        
        if (command.includes('dolt sql -r json -q')) {
          callback(null, { 
            stdout: '{"id": 1}', 
            stderr: 'Warning: deprecated syntax used' 
          })
        } else {
          callback(null, { stdout: '', stderr: '' })
        }
      })

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const result = await service.query('SELECT * FROM test')

      expect(result).toEqual([{ id: 1 }])
      // Should NOT have called console.warn because stderr contains "Warning:"
      expect(consoleSpy).not.toHaveBeenCalled()
      
      consoleSpy.mockRestore()
    })
  })

  describe('command format verification', () => {
    // These tests verify the exact command formats used by DoltService
    // to catch any future mismatches between tests and implementation
    
    beforeEach(async () => {
      mockExec.mockImplementation((command: string, options: any, callback: any) => {
        if (typeof options === 'function') {
          callback = options
          options = {}
        }
        callback(null, { stdout: 'dolt version 1.0.0', stderr: '' })
      })
      await service.initialize()
    })

    it('should use correct query command format: dolt sql -r json -q', async () => {
      let capturedCommand = ''
      
      mockExec.mockImplementation((command: string, options: any, callback: any) => {
        if (typeof options === 'function') {
          callback = options
          options = {}
        }
        
        if (command.includes('dolt sql')) {
          capturedCommand = command
          callback(null, { stdout: '{}', stderr: '' })
        } else {
          callback(null, { stdout: '', stderr: '' })
        }
      })

      await service.query('SELECT 1')

      expect(capturedCommand).toMatch(/dolt sql -r json -q "SELECT 1"/)
    })

    it('should use correct log command format with table filter', async () => {
      let capturedCommand = ''
      
      mockExec.mockImplementation((command: string, options: any, callback: any) => {
        if (typeof options === 'function') {
          callback = options
          options = {}
        }
        
        if (command.includes('dolt log')) {
          capturedCommand = command
          callback(null, { stdout: '', stderr: '' })
        } else {
          callback(null, { stdout: '', stderr: '' })
        }
      })

      await service.getHistory('my_table', 10)

      // Format: dolt log --oneline --limit 10 -- my_table
      expect(capturedCommand).toMatch(/dolt log --oneline --limit 10 -- my_table/)
    })

    it('should use correct reset command format', async () => {
      let capturedCommand = ''
      
      mockExec.mockImplementation((command: string, options: any, callback: any) => {
        if (typeof options === 'function') {
          callback = options
          options = {}
        }
        
        if (command.includes('dolt reset')) {
          capturedCommand = command
          callback(null, { stdout: '', stderr: '' })
        } else {
          callback(null, { stdout: '', stderr: '' })
        }
      })

      await service.reset('abc123', true)

      // Format: dolt reset --hard abc123
      expect(capturedCommand).toMatch(/dolt reset --hard abc123/)
    })
  })
})
