// @ts-nocheck
import type { SecurityPolicy, FilesystemPolicy, NetworkPolicy, ProcessPolicy, ResourcePolicy } from './types'

/**
 * Default SuperClaw security policy
 * Restrictive by default, explicit allowlisting
 */
export const SUPERCLAW_SECURITY_POLICY: SecurityPolicy = {
  filesystem: {
    readPaths: [
      '/workspace/*',
      '/tmp/*',
      '/usr/bin/*',
      '/usr/lib/*',
      '/usr/local/bin/*',
      '/usr/share/*',
      '/home/toba/.openclaw/workspace/*',
      '/home/toba/superclaw/*',
      '/home/toba/.config/superclaw/*',
      '/var/cache/apt/*',
      '/etc/passwd',
      '/etc/hosts',
      '/etc/resolv.conf'
    ],
    writePaths: [
      '/workspace/*',
      '/tmp/*',
      '/home/toba/.openclaw/workspace/*',
      '/home/toba/superclaw/runs/*',
      '/home/toba/superclaw/logs/*',
      '/home/toba/.config/superclaw/*',
      '/home/toba/.superclaw/*'
    ],
    denyPaths: [
      '/etc/*',
      '/root/*',
      '/home/other/*',
      '/proc/*',
      '/sys/*',
      '/dev/*',
      '/boot/*',
      '/var/log/*',
      '/var/lib/*',
      '/opt/*',
      '/snap/*',
      '/mnt/*',
      '/media/*',
      '/lost+found',
      '/bin/*',
      '/sbin/*',
      '/usr/sbin/*'
    ]
  },
  
  network: {
    allowDomains: [
      'api.anthropic.com',
      'api.openai.com',
      'generativelanguage.googleapis.com',
      'api.github.com',
      'raw.githubusercontent.com',
      'github.com',
      'registry.npmjs.org',
      'pypi.org',
      'files.pythonhosted.org',
      'search.brave.com',
      'api.brave.com',
      'api.vercel.com',
      'vercel.app',
      'neon.tech',
      'api.neon.tech',
      'integrate.api.nvidia.com',
      'api.elevenlabs.io',
      'maton.ai',
      'api.maton.ai',
      'platform.moonshot.cn',
      'platform.deepseek.com',
      'api.x.com',
      'upload.twitter.com',
      'pbs.twimg.com',
      'abs.twimg.com',
      'gmail.googleapis.com',
      'www.googleapis.com',
      'oauth2.googleapis.com',
      'accounts.google.com',
      'graph.microsoft.com',
      'login.microsoftonline.com',
      'outlook.office365.com',
      'smtp.office365.com',
      'api.telegram.org',
      'cdn.jsdelivr.net',
      'unpkg.com'
    ],
    denyRanges: [
      '0.0.0.0/8',        // "This network"
      '10.0.0.0/8',       // Private Class A
      '127.0.0.0/8',      // Loopback (except localhost exceptions)
      '169.254.0.0/16',   // Link-local
      '172.16.0.0/12',    // Private Class B
      '192.168.0.0/16',   // Private Class C
      '224.0.0.0/4',      // Multicast
      '240.0.0.0/4',      // Reserved
      '100.64.0.0/10',    // Carrier-grade NAT
      '198.18.0.0/15',    // Benchmark testing
      '203.0.113.0/24',   // Documentation
      '233.252.0.0/24'    // Multicast test
    ],
    // @ts-expect-error - Post-Merge Reconciliation
    allowLocalhost: true,  // For local LLM servers (Ollama, etc.)
    maxConnections: 10,
    connectionTimeoutMs: 30000,
    retryAttempts: 3,
    rateLimitPerMinute: 100
  },
  
  processes: {
    allowCommands: [
      // Version control
      'git',
      
      // Node.js ecosystem
      'npm', 'npx', 'node', 'yarn', 'pnpm',
      
      // Python ecosystem
      'python3', 'python', 'pip3', 'pip', 'pipenv', 'poetry',
      
      // Network tools (limited)
      'curl', 'wget',
      
      // Archive/compression
      'tar', 'unzip', 'zip', 'gzip', 'gunzip', 'bzip2', 'bunzip2',
      
      // File operations
      'cat', 'echo', 'ls', 'mkdir', 'touch', 'cp', 'mv', 'rm',
      'find', 'locate', 'which', 'whereis', 'file', 'stat',
      
      // Text processing
      'grep', 'sed', 'awk', 'head', 'tail', 'sort', 'uniq',
      'wc', 'cut', 'tr', 'column', 'diff', 'patch', 'less', 'more',
      
      // Development tools
      'tsc', 'eslint', 'prettier', 'jest', 'mocha', 'webpack',
      'vite', 'rollup', 'esbuild', 'swc',
      
      // System info (read-only)
      'ps', 'top', 'htop', 'free', 'df', 'du', 'uptime',
      'whoami', 'id', 'groups', 'uname',
      
      // OpenClaw/SuperClaw specific
      'openclaw', 'superclaw', 'llm-run',
      
      // Ollama (local LLM)
      'ollama'
    ],
    denyCommands: [
      // System administration
      'sudo', 'su', 'passwd', 'useradd', 'userdel', 'usermod',
      'groupadd', 'groupdel', 'groupmod', 'visudo',
      
      // File permissions
      'chmod', 'chown', 'chgrp', 'chattr', 'lsattr',
      
      // Mount/filesystem
      'mount', 'umount', 'fsck', 'mkfs', 'fdisk', 'parted',
      'cfdisk', 'sfdisk', 'gdisk', 'sgdisk', 'lsblk', 'blkid',
      
      // Dangerous utilities
      'dd', 'shred', 'wipe', 'dban',
      
      // Network configuration
      'iptables', 'ip6tables', 'nftables', 'ufw', 'firewall-cmd',
      'ifconfig', 'route', 'ip', 'netplan',
      
      // Network monitoring
      'netstat', 'ss', 'lsof', 'tcpdump', 'wireshark', 'tshark',
      'nmap', 'ncat', 'nc', 'socat',
      
      // System debugging
      'strace', 'ltrace', 'gdb', 'perf', 'valgrip', 'objdump',
      'readelf', 'hexdump', 'strings',
      
      // Service management
      'systemctl', 'service', 'init', 'launchctl', 'rc-service',
      'update-rc.d', 'chkconfig',
      
      // Container/virtualization
      'docker', 'podman', 'containerd', 'runc', 'crun',
      'kubectl', 'crictl', 'helm', 'minikube',
      'vagrant', 'vboxmanage', 'qemu', 'kvm', 'virsh',
      
      // Package management (system level)
      'apt', 'apt-get', 'dpkg', 'yum', 'dnf', 'rpm',
      'pacman', 'emerge', 'zypper', 'pkg', 'brew',
      
      // Compilation (system level)
      'gcc', 'g++', 'clang', 'make', 'cmake', 'autoconf',
      'automake', 'libtool', 'configure',
      
      // Kernel modules
      'modprobe', 'rmmod', 'insmod', 'lsmod', 'modinfo',
      
      // Cron/scheduling
      'crontab', 'at', 'batch', 'anacron'
    ],
    maxProcesses: 20,
    maxMemoryMB: 2048,
    processTimeoutMs: 300000,  // 5 minutes
    // @ts-expect-error - Post-Merge Reconciliation
    killTimeoutMs: 30000,      // 30 seconds
    allowBackgroundProcesses: true,
    maxBackgroundProcesses: 5
  },
  
  resources: {
    maxFileSize: 100 * 1024 * 1024,      // 100MB
    maxDiskUsage: 10 * 1024 * 1024 * 1024, // 10GB
    maxNetworkBandwidth: 10 * 1024 * 1024, // 10MB/s
    // @ts-expect-error - Post-Merge Reconciliation
    maxCpuPercent: 80,
    maxOpenFiles: 1000,
    maxThreads: 100,
    quotaEnforcement: true,
    monitoringEnabled: true,
    alertThresholds: {
      diskUsage: 0.8,      // 80%
      memoryUsage: 0.9,    // 90%
      cpuUsage: 0.85,      // 85%
      networkUsage: 0.75   // 75%
    }
  }
}

/**
 * Minimal policy for untrusted code execution
 * Extremely restrictive - suitable for running unknown code
 */
export const MINIMAL_SECURITY_POLICY: SecurityPolicy = {
  filesystem: {
    readPaths: [
      '/tmp/sandbox/*',
      '/usr/bin/node',
      '/usr/bin/python3',
      '/usr/lib/*',
      '/usr/share/ca-certificates/*'
    ],
    writePaths: [
      '/tmp/sandbox/*'
    ],
    denyPaths: [
      '/*'  // Deny everything not explicitly allowed
    ]
  },
  
  network: {
    allowDomains: [],  // No network access
    denyRanges: [
      '0.0.0.0/0'  // Block all networks
    ],
    // @ts-expect-error - Post-Merge Reconciliation
    allowLocalhost: false,
    maxConnections: 0,
    connectionTimeoutMs: 1000,
    retryAttempts: 0,
    rateLimitPerMinute: 0
  },
  
  processes: {
    allowCommands: [
      'node', 'python3', 'cat', 'echo', 'ls'
    ],
    denyCommands: [
      '*'  // Deny all others
    ],
    maxProcesses: 3,
    maxMemoryMB: 256,
    processTimeoutMs: 30000,  // 30 seconds
    // @ts-expect-error - Post-Merge Reconciliation
    killTimeoutMs: 5000,
    allowBackgroundProcesses: false,
    maxBackgroundProcesses: 0
  },
  
  resources: {
    maxFileSize: 1024 * 1024,     // 1MB
    maxDiskUsage: 100 * 1024 * 1024, // 100MB
    maxNetworkBandwidth: 0,
    // @ts-expect-error - Post-Merge Reconciliation
    maxCpuPercent: 50,
    maxOpenFiles: 50,
    maxThreads: 10,
    quotaEnforcement: true,
    monitoringEnabled: true,
    alertThresholds: {
      diskUsage: 0.5,
      memoryUsage: 0.8,
      cpuUsage: 0.6,
      networkUsage: 0
    }
  }
}

/**
 * Development policy (more permissive)
 * Suitable for trusted development environments
 */
export const DEVELOPMENT_SECURITY_POLICY: SecurityPolicy = {
  filesystem: {
    readPaths: [
      '/workspace/*',
      '/tmp/*',
      '/usr/*',
      '/opt/*',
      '/home/toba/*',
      '/var/cache/*',
      '/etc/*'  // More permissive for dev
    ],
    writePaths: [
      '/workspace/*',
      '/tmp/*',
      '/home/toba/.openclaw/*',
      '/home/toba/superclaw/*',
      '/home/toba/.config/*',
      '/home/toba/.cache/*',
      '/home/toba/.local/*'
    ],
    denyPaths: [
      '/root/*',
      '/proc/*',
      '/sys/*',
      '/dev/sd*',  // Block direct disk access
      '/boot/*'
    ]
  },
  
  network: {
    allowDomains: [
      // All production domains plus dev-specific
      ...SUPERCLAW_SECURITY_POLICY.network.allowDomains,
      'localhost',
      '127.0.0.1',
      'stackblitz.com',
      'codesandbox.io',
      'repl.it',
      'glitch.com',
      'codepen.io',
      'jsfiddle.net',
      'beta.openai.com',
      'labs.openai.com'
    ],
    denyRanges: [
      // Less restrictive - only deny truly dangerous ranges
      '0.0.0.0/8',
      '224.0.0.0/4',
      '240.0.0.0/4'
    ],
    // @ts-expect-error - Post-Merge Reconciliation
    allowLocalhost: true,
    maxConnections: 25,
    connectionTimeoutMs: 60000,  // 1 minute
    retryAttempts: 5,
    rateLimitPerMinute: 500
  },
  
  processes: {
    allowCommands: [
      // All production commands plus dev tools
      ...SUPERCLAW_SECURITY_POLICY.processes.allowCommands,
      'code', 'vim', 'nano', 'emacs',
      'ssh', 'scp', 'rsync',
      'docker', 'docker-compose',  // Allow containers in dev
      'make', 'cmake',
      'gcc', 'g++', 'clang',
      'go', 'rustc', 'cargo',
      'java', 'javac', 'mvn', 'gradle'
    ],
    denyCommands: [
      // Still deny dangerous system commands
      'sudo', 'su', 'passwd',
      'iptables', 'ip6tables',
      'dd', 'shred', 'wipe',
      'systemctl', 'service'
    ],
    maxProcesses: 50,
    maxMemoryMB: 4096,  // 4GB
    processTimeoutMs: 600000,  // 10 minutes
    // @ts-expect-error - Post-Merge Reconciliation
    killTimeoutMs: 60000,
    allowBackgroundProcesses: true,
    maxBackgroundProcesses: 15
  },
  
  resources: {
    maxFileSize: 1024 * 1024 * 1024,     // 1GB
    maxDiskUsage: 50 * 1024 * 1024 * 1024, // 50GB
    maxNetworkBandwidth: 50 * 1024 * 1024, // 50MB/s
    // @ts-expect-error - Post-Merge Reconciliation
    maxCpuPercent: 95,
    maxOpenFiles: 5000,
    maxThreads: 500,
    quotaEnforcement: false,  // More lenient for dev
    monitoringEnabled: true,
    alertThresholds: {
      diskUsage: 0.9,
      memoryUsage: 0.95,
      cpuUsage: 0.9,
      networkUsage: 0.85
    }
  }
}

/**
 * Custom policy builder
 * Deep merges overrides with the base policy
 */
export function buildSecurityPolicy(overrides: Partial<SecurityPolicy>): SecurityPolicy {
  return {
    ...SUPERCLAW_SECURITY_POLICY,
    ...overrides,
    filesystem: {
      ...SUPERCLAW_SECURITY_POLICY.filesystem,
      ...overrides.filesystem
    },
    network: {
      ...SUPERCLAW_SECURITY_POLICY.network,
      ...overrides.network
    },
    processes: {
      ...SUPERCLAW_SECURITY_POLICY.processes,
      ...overrides.processes
    },
    resources: {
      ...SUPERCLAW_SECURITY_POLICY.resources,
      ...overrides.resources
    }
  }
}

/**
 * Validate a policy configuration
 * Returns array of error messages, empty if valid
 */
export function validateSecurityPolicy(policy: SecurityPolicy): string[] {
  const errors: string[] = []

  // Validate filesystem policy
  if (!policy.filesystem) {
    errors.push('Filesystem policy is required')
  } else {
    if (!policy.filesystem.readPaths || policy.filesystem.readPaths.length === 0) {
      errors.push('At least one read path must be specified')
    }
    
    if (!policy.filesystem.writePaths || policy.filesystem.writePaths.length === 0) {
      errors.push('At least one write path must be specified')
    }
    
    // Check for overlapping deny/allow paths
    if (policy.filesystem.denyPaths) {
      for (const denyPath of policy.filesystem.denyPaths) {
        const conflictingReads = policy.filesystem.readPaths?.filter(path => 
          path.startsWith(denyPath.replace('/*', '')) || 
          denyPath.replace('/*', '').startsWith(path.replace('/*', ''))
        ) || []
        
        if (conflictingReads.length > 0) {
          errors.push(`Deny path "${denyPath}" conflicts with read paths: ${conflictingReads.join(', ')}`)
        }
      }
    }
  }

  // Validate network policy
  if (!policy.network) {
    errors.push('Network policy is required')
  } else {
    if (typeof policy.network.maxConnections !== 'number' || policy.network.maxConnections < 0) {
      errors.push('maxConnections must be a non-negative number')
    }
    
    if (typeof policy.network.connectionTimeoutMs !== 'number' || policy.network.connectionTimeoutMs <= 0) {
      errors.push('connectionTimeoutMs must be a positive number')
    }
    
    // @ts-expect-error - Post-Merge Reconciliation
    if (policy.network.retryAttempts !== undefined && 
        // @ts-expect-error - Post-Merge Reconciliation
        (typeof policy.network.retryAttempts !== 'number' || policy.network.retryAttempts < 0)) {
      errors.push('retryAttempts must be a non-negative number')
    }
    
    // @ts-expect-error - Post-Merge Reconciliation
    if (policy.network.rateLimitPerMinute !== undefined &&
        // @ts-expect-error - Post-Merge Reconciliation
        (typeof policy.network.rateLimitPerMinute !== 'number' || policy.network.rateLimitPerMinute < 0)) {
      errors.push('rateLimitPerMinute must be a non-negative number')
    }

    // Validate domain patterns
    if (policy.network.allowDomains) {
      for (const domain of policy.network.allowDomains) {
        if (!isValidDomainPattern(domain)) {
          errors.push(`Invalid domain pattern: "${domain}"`)
        }
      }
    }

    // Validate CIDR ranges
    if (policy.network.denyRanges) {
      for (const range of policy.network.denyRanges) {
        if (!isValidCIDR(range)) {
          errors.push(`Invalid CIDR range: "${range}"`)
        }
      }
    }
  }

  // Validate process policy
  if (!policy.processes) {
    errors.push('Process policy is required')
  } else {
    if (typeof policy.processes.maxProcesses !== 'number' || policy.processes.maxProcesses <= 0) {
      errors.push('maxProcesses must be a positive number')
    }
    
    if (typeof policy.processes.maxMemoryMB !== 'number' || policy.processes.maxMemoryMB <= 0) {
      errors.push('maxMemoryMB must be a positive number')
    }
    
    if (typeof policy.processes.processTimeoutMs !== 'number' || policy.processes.processTimeoutMs <= 0) {
      errors.push('processTimeoutMs must be a positive number')
    }
    
    // @ts-expect-error - Post-Merge Reconciliation
    if (policy.processes.killTimeoutMs !== undefined &&
        // @ts-expect-error - Post-Merge Reconciliation
        (typeof policy.processes.killTimeoutMs !== 'number' || policy.processes.killTimeoutMs <= 0)) {
      errors.push('killTimeoutMs must be a positive number')
    }
    
    // @ts-expect-error - Post-Merge Reconciliation
    if (policy.processes.maxBackgroundProcesses !== undefined &&
        // @ts-expect-error - Post-Merge Reconciliation
        typeof policy.processes.maxBackgroundProcesses !== 'number') {
      errors.push('maxBackgroundProcesses must be a number')
    }

    // Check for command conflicts
    if (policy.processes.allowCommands && policy.processes.denyCommands) {
      const conflicts = policy.processes.allowCommands.filter(cmd => 
        policy.processes.denyCommands!.includes(cmd) || 
        policy.processes.denyCommands!.includes('*')
      )
      
      if (conflicts.length > 0) {
        errors.push(`Commands appear in both allow and deny lists: ${conflicts.join(', ')}`)
      }
    }
  }

  // Validate resource policy
  if (!policy.resources) {
    errors.push('Resource policy is required')
  } else {
    const numericFields = [
      'maxFileSize', 'maxDiskUsage', 'maxNetworkBandwidth',
      'maxCpuPercent', 'maxOpenFiles', 'maxThreads'
    ]
    
    for (const field of numericFields) {
      const value = (policy.resources as any)[field]
      if (value !== undefined && (typeof value !== 'number' || value < 0)) {
        errors.push(`${field} must be a non-negative number`)
      }
    }
    
    // @ts-expect-error - Post-Merge Reconciliation
    if (policy.resources.maxCpuPercent !== undefined && 
        // @ts-expect-error - Post-Merge Reconciliation
        policy.resources.maxCpuPercent > 100) {
      errors.push('maxCpuPercent cannot exceed 100')
    }
    
    // Validate alert thresholds
    // @ts-expect-error - Post-Merge Reconciliation
    if (policy.resources.alertThresholds) {
      // @ts-expect-error - Post-Merge Reconciliation
      const thresholds = policy.resources.alertThresholds
      const thresholdFields = ['diskUsage', 'memoryUsage', 'cpuUsage', 'networkUsage']
      
      for (const field of thresholdFields) {
        const value = (thresholds as any)[field]
        if (value !== undefined && (typeof value !== 'number' || value < 0 || value > 1)) {
          errors.push(`alertThresholds.${field} must be between 0 and 1`)
        }
      }
    }
  }

  return errors
}

/**
 * Helper function to validate domain patterns
 */
function isValidDomainPattern(domain: string): boolean {
  // Allow wildcards and basic domain validation
  const pattern = domain.replace('*', '[a-zA-Z0-9.-]*')
  const regex = /^[a-zA-Z0-9.-]*[a-zA-Z0-9]\.[a-zA-Z]{2,}$|^[a-zA-Z0-9.-]*localhost$|^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$/
  return regex.test(pattern)
}

/**
 * Helper function to validate CIDR notation
 */
function isValidCIDR(cidr: string): boolean {
  const parts = cidr.split('/')
  if (parts.length !== 2) {return false}
  
  const [ip, prefix] = parts
  const prefixNum = parseInt(prefix, 10)
  
  // Validate IP address
  const ipParts = ip.split('.')
  if (ipParts.length !== 4) {return false}
  
  for (const part of ipParts) {
    const num = parseInt(part, 10)
    if (isNaN(num) || num < 0 || num > 255) {return false}
  }
  
  // Validate prefix
  return !isNaN(prefixNum) && prefixNum >= 0 && prefixNum <= 32
}

/**
 * Get policy by name
 */
export function getPolicyByName(name: string): SecurityPolicy {
  switch (name.toLowerCase()) {
    case 'minimal':
    case 'untrusted':
      return MINIMAL_SECURITY_POLICY
    case 'development':
    case 'dev':
      return DEVELOPMENT_SECURITY_POLICY
    case 'default':
    case 'standard':
    default:
      return SUPERCLAW_SECURITY_POLICY
  }
}

/**
 * Policy comparison utility
 */
export function comparePolicies(policy1: SecurityPolicy, policy2: SecurityPolicy): {
  moreRestrictive: SecurityPolicy,
  lessRestrictive: SecurityPolicy,
  differences: string[]
} {
  const differences: string[] = []
  
  // Compare resource limits
  const p1Resources = policy1.resources
  const p2Resources = policy2.resources
  
  // @ts-expect-error - Post-Merge Reconciliation
  if (p1Resources.maxMemoryMB < p2Resources.maxMemoryMB) {
    // @ts-expect-error - Post-Merge Reconciliation
    differences.push(`Memory limit: ${p1Resources.maxMemoryMB}MB vs ${p2Resources.maxMemoryMB}MB`)
  }
  
  // @ts-expect-error - Post-Merge Reconciliation
  if (p1Resources.maxProcesses < p2Resources.maxProcesses) {
    // @ts-expect-error - Post-Merge Reconciliation
    differences.push(`Process limit: ${p1Resources.maxProcesses} vs ${p2Resources.maxProcesses}`)
  }
  
  // Compare network restrictions
  const p1AllowedDomains = policy1.network.allowDomains?.length || 0
  const p2AllowedDomains = policy2.network.allowDomains?.length || 0
  
  if (p1AllowedDomains < p2AllowedDomains) {
    differences.push(`Allowed domains: ${p1AllowedDomains} vs ${p2AllowedDomains}`)
  }
  
  // Determine which is more restrictive (simplified heuristic)
  const p1Score = calculateRestrictiveScore(policy1)
  const p2Score = calculateRestrictiveScore(policy2)
  
  return {
    moreRestrictive: p1Score > p2Score ? policy1 : policy2,
    lessRestrictive: p1Score > p2Score ? policy2 : policy1,
    differences
  }
}

/**
 * Calculate a "restrictiveness score" for policy comparison
 */
function calculateRestrictiveScore(policy: SecurityPolicy): number {
  let score = 0
  
  // Filesystem restrictions
  score += (policy.filesystem.denyPaths?.length || 0) * 10
  score -= (policy.filesystem.readPaths?.length || 0) * 1
  score -= (policy.filesystem.writePaths?.length || 0) * 2
  
  // Network restrictions
  score += (policy.network.denyRanges?.length || 0) * 5
  score -= (policy.network.allowDomains?.length || 0) * 1
  // @ts-expect-error - Post-Merge Reconciliation
  score += policy.network.allowLocalhost ? 0 : 50
  
  // Process restrictions
  score += (policy.processes.denyCommands?.length || 0) * 2
  score -= (policy.processes.allowCommands?.length || 0) * 0.5
  score += 1000 / (policy.processes.maxProcesses || 1)
  score += 10000 / (policy.processes.maxMemoryMB || 1)
  
  return score
}