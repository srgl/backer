module.exports = class Volume {
  DEFAULT_BACKUP_SCHEDULE = '0 1 * * *'
  DEFAULT_SIZE = '1G'
  DEFAULT_FORGET_POLICY = 'l10 h24 d7 w52 m120 y100'
  DEFAULT_FORGET_SCHEDULE = '0 1 * * 7'
  VOLUMES_ROOT = '/mnt/volumes'
  SHARED_PATH = '/mnt/shared/backer'
  timestamp = 0
  mounts = {}
  backupJob = null
  forgetJob = null

  get mountpoint () { return `${this.VOLUMES_ROOT}/${this.name}` }

  get data () { return `${this.VOLUMES_ROOT}/${this.name}/_data` }

  get snapshot () { return `${this.SHARED_PATH}/${this.name}` }

  get image () { return `${this.SHARED_PATH}/${this.name}.img` }

  constructor (opts) {
    this.name = opts.name
    this.size = opts.size || this.DEFAULT_SIZE
    this.backupSchedule = opts.backupSchedule || this.DEFAULT_SCHEDULE
    this.restore = opts.restore || false
    this.forgetPolicy = opts.forgetPolicy || this.DEFAULT_FORGET_POLICY
    this.forgetSchedule = opts.forgetSchedule || this.DEFAULT_FORGET_SCHEDULE
    this.env = opts.env || {}
  }

  toJSON () {
    return {
      name: this.name,
      size: this.size,
      backupSchedule: this.backupSchedule,
      restore: this.restore,
      forgetPolicy: this.forgetPolicy,
      forgetSchedule: this.forgetSchedule,
      timestamp: this.timestamp,
      env: this.env
    }
  }
}
