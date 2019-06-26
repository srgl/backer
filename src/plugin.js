const http = require('http')
const fs = require('fs').promises
const execa = require('execa')
const { CronJob } = require('cron')
const AsyncLock = require('async-lock')
const utils = require('./utils')
const Volume = require('./volume')

module.exports = class Plugin {
  SHARED_PATH = '/mnt/shared/backer'
  VOLUMES_JSON = `${this.SHARED_PATH}/volumes.json`
  SOCKET_ADDRESS = '/run/docker/plugins/backer.sock'
  server = http.createServer(this.handler.bind(this))
  lock = new AsyncLock()
  volumes = { }

  static async run () {
    const plugin = new this()
    await execa('mkdir', ['-p', plugin.SHARED_PATH])
    await plugin.loadVolumes()
    plugin.server.listen(plugin.SOCKET_ADDRESS)
  }

  async handler (req, res) {
    const action = req.url.slice(1)
    const body = await utils.receiveBody(req)
    console.log(`Action ${action}, ${JSON.stringify(body)}`)

    const actions = {
      'Plugin.Activate': this.activate,
      'VolumeDriver.Create': this.create,
      'VolumeDriver.Remove': this.remove,
      'VolumeDriver.Mount': this.mount,
      'VolumeDriver.Path': this.path,
      'VolumeDriver.Unmount': this.unmount,
      'VolumeDriver.Get': this.get,
      'VolumeDriver.List': this.list,
      'VolumeDriver.Capabilities': this.capabilities
    }

    let result
    try {
      if (!(action in actions)) throw new Error('Not supported')
      result = await actions[action].call(this, body)
    } catch (e) {
      console.error(`Error processing action ${action}:`, e)
      result = { Err: e.message }
    }

    res.end(JSON.stringify(result || {}))
  }

  async loadVolumes () {
    try {
      const json = await fs.readFile(this.VOLUMES_JSON)
      for (let volume of JSON.parse(json)) {
        this.volumes[volume.name] = new Volume(volume)
        this.schedule(this.volumes[volume.name])
      }
    } catch (e) {
      console.log('Unable to load volumes:', e.message)
    }
  }

  async saveVolumes () {
    await this.lock.acquire(this.VOLUMES_JSON, async () => {
      const json = JSON.stringify(Object.values(this.volumes), null, 2)
      await fs.writeFile(this.VOLUMES_JSON, json)
    })
  }

  async create ({ Name: name, Opts: opts }) {
    await this.lock.acquire(name, async () => {
      if (name in this.volumes) {
        throw new Error(`Volume ${name} already exists`)
      }

      const volume = new Volume({
        name,
        size: opts.size,
        backupSchedule: opts.backup_schedule,
        restore: /^[1y]$/i.test(opts.restore || ''),
        forgetPolicy: opts.forget_policy,
        forgetSchedule: opts.forget_schedule,
        env: Object.keys(opts)
          .filter(opt => opt.startsWith('env_'))
          .map(opt => ({ [opt.slice(4).toUpperCase()]: opts[opt] }))
          .reduce((o, opt) => ({ ...o, ...opt }), {})
      })
      await execa('truncate', ['-s', volume.size, volume.image])
      await execa('mkfs.ext4', [volume.image])
      await execa('mkdir', ['-p', volume.mountpoint])
      await execa('mount', [volume.image, volume.mountpoint])
      await execa('mkdir', ['-p', volume.data])
      await execa('umount', [volume.mountpoint])

      this.volumes[name] = volume
      this.schedule(volume)
      await this.saveVolumes()
    })
  }

  async remove ({ Name: name }) {
    await this.lock.acquire(name, async () => {
      const volume = this.volumes[name]
      if (!volume) throw new Error(`Volume ${name} doesn't exist`)

      if (await utils.isMounted(volume.mountpoint)) {
        await execa('umount', [volume.mountpoint])
      }

      await Promise.all([
        execa('rm', ['-rf', volume.mountpoint]),
        execa('rm', ['-rf', volume.snapshot]),
        execa('rm', ['-rf', volume.image])
      ])

      this.unschedule(volume)
      delete this.volumes[name]
      await this.saveVolumes()
    })
  }

  async mount ({ Name: name, ID: id }) {
    return this.lock.acquire(name, async () => {
      const volume = this.volumes[name]
      if (!volume) throw new Error(`Volume ${name} doesn't exist`)

      if (!(await utils.isMounted(volume.mountpoint))) {
        await execa('mkdir', ['-p', volume.mountpoint])
        await execa('mount', [volume.image, volume.mountpoint])
        if (volume.restore) await this.restore(volume)
      }

      volume.mounts[id] = 1
      return { Mountpoint: volume.data }
    })
  }

  async unmount ({ Name: name, ID: id }) {
    await this.lock.acquire(name, async () => {
      const volume = this.volumes[name]
      if (!volume) throw new Error(`Volume ${name} doesn't exist`)

      delete volume.mounts[id]

      if (!Object.keys(volume.mounts).length &&
        await utils.isMounted(volume.mountpoint)) {
        await execa('umount', [volume.mountpoint])
      }
    })
  }

  async path ({ Name: name }) {
    return this.lock.acquire(name, async () => {
      const volume = this.volumes[name]
      if (!volume) throw new Error(`Volume ${name} doesn't exist`)

      return { Mountpoint: volume.data }
    })
  }

  async get ({ Name: name }) {
    return this.lock.acquire(name, async () => {
      const volume = this.volumes[name]
      if (!volume) throw new Error(`Volume ${name} doesn't exist`)

      return {
        Volume: {
          Name: name,
          Mountpoint: volume.data,
          Status: {
            mounted: await utils.isMounted(volume.mountpoint)
          }
        }
      }
    })
  }

  async list () {
    const volumes = Object.keys(this.volumes)
    return this.lock.acquire(volumes, async () => {
      return {
        Volumes: Object.values(this.volumes).map(volume => ({
          Name: volume.name,
          Mountpoint: volume.data
        }))
      }
    })
  }

  activate () {
    return { Implements: ['VolumeDriver'] }
  }

  capabilities () {
    return { Capabilities: { Scope: 'local' } }
  }

  schedule (volume) {
    this.unschedule(volume)

    volume.backupJob = new CronJob(volume.backupSchedule, async () => {
      await this.lock.acquire(volume.name, async () => {
        await this.backup(volume)
      })
    })
    volume.forgetJob = new CronJob(volume.forgetSchedule, async () => {
      await this.lock.acquire(volume.name, async () => {
        await this.forget(volume)
      })
    })
    volume.backupJob.start()
    volume.forgetJob.start()
  }

  unschedule (volume) {
    if (volume.backupJob) volume.backupJob.stop()
    if (volume.forgetJob) volume.forgetJob.stop()
  }

  async backup (volume) {
    if (!Object.keys(volume.mounts).length ||
      !(await utils.isMounted(volume.mountpoint))) return

    volume.timestamp = Math.floor(Date.now() / 1000)
    await this.saveVolumes()

    console.log(`Backing up volume ${volume.name}...`)
    try {
      await utils.preSync(volume.data, volume.snapshot)
      console.log(`Pre-sync of volume ${volume.name} finished`)

      await utils.sync(volume.data, volume.snapshot)
      console.log(`Sync of volume ${volume.name} finished`)

      await utils.backup(volume.snapshot, volume.name,
        volume.env, volume.timestamp)
      console.log(`Backup of volume ${volume.name} uploaded`)
    } catch (e) {
      console.error(`Error while backing up volume ${volume.name}:`, e)
    }
  }

  async restore (volume) {
    console.log(`Restoring volume ${volume.name}...`)
    const snapshot = await utils.getLatestSnapshot(volume.name, volume.env)
    if (!snapshot || snapshot.timestamp <= volume.timestamp) {
      console.log(`No suitable snapshot found for ${volume.name}`)
      return
    }

    console.log(`Found snapshot ${snapshot.short_id} of ${volume.name}`)
    await utils.restore(snapshot.id, volume.mountpoint, volume.env)
    volume.timestamp = snapshot.timestamp
    await this.saveVolumes()
    console.log(`Finished restoring snapshot ${snapshot.short_id}`)
  }

  async forget (volume) {
    console.log(`Forgetting snapshots of volume ${volume.name}...`)
    await utils.forget(volume.name, volume.forgetPolicy, volume.env)
    console.log(`Finished forgetting snapshots of ${volume.name}...`)
  }
}
