const execa = require('execa')

class Utils {
  async preSync (src, dst) {
    try {
      await execa('sync')
      await execa('rsync', ['-aAX', '--delete', src, dst])
    } catch (e) {
      if (e.code !== 24) throw e
    }
  }

  async sync (src, dst) {
    try {
      await execa('fsfreeze', ['-f', src])
      await execa('rsync', ['-aAX', '--delete', src, dst])
    } catch (e) {
      throw e
    } finally {
      await execa('fsfreeze', ['-u', src])
    }
  }

  async backup (cwd, name, env, timestamp) {
    const time = new Date(timestamp * 1000)
      .toISOString().replace('T', ' ').slice(0, -5)
    let i = 0
    while ((i += 1)) {
      try {
        await execa('restic',
          ['backup', '.', '--time', time, '--tag', 'backer', '--tag', name],
          { env, cwd })
        break
      } catch (e) {
        if (!e.stderr.includes('unable to open config') || i > 1) throw e
        await execa('restic', ['init'], { env })
      }
    }
  }

  async getLatestSnapshot (name, env) {
    try {
      const { stdout } = await execa('restic',
        ['snapshots', '--json', '--last', '--tag', `backer,${name}`], { env })
      const snapshots = JSON.parse(stdout) || []
      snapshots.forEach(snapshot => {
        snapshot.timestamp =
          Math.floor(new Date(snapshot.time).getTime() / 1000)
      })
      snapshots.sort((a, b) => b.timestamp - a.timestamp)

      return snapshots[0] || null
    } catch (e) {
      if (e.stderr.includes('unable to open config')) return null
      throw e
    }
  }

  async restore (id, cwd, env) {
    await execa('rm', ['-rf', cwd + '/_data'])
    await execa('restic', ['restore', id, '--target', '.'], { env, cwd })
  }

  async forget (name, policy, env) {
    try {
      const keeps = policy
        .replace('l', '--keep-last=')
        .replace('y', '--keep-yearly=')
        .replace('h', '--keep-hourly=')
        .replace('d', '--keep-daily=')
        .replace('w', '--keep-weekly=')
        .replace('m', '--keep-monthly=')
        .split(' ')
      await execa('restic',
        ['forget', ...keeps, '--tag', `backer,${name}`, '--prune', '--json'],
        { env })
    } catch (e) {
      if (e.stderr.includes('unable to open config')) return
      throw e
    }
  }

  async isMounted (mountpoint) {
    try {
      await execa('mountpoint', ['-q', mountpoint])
    } catch (e) { return false }
    return true
  }

  async receiveBody (req) {
    return new Promise(resolve => {
      let body = ''
      req.on('data', data => { body += data.toString() })
      req.on('end', () => resolve(JSON.parse(body || null)))
    })
  }
}

module.exports = new Utils()
