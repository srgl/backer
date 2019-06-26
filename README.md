# Backer volume plugin
Backer is a backup and persisting solution for docker volumes built on top of the [restic](https://github.com/restic/restic).
* Produces consistent backups by calling `fsfreeze` of underlying volume loopback filesystem before taking snapshot
* Optionally restores the last snapshot before volume mount
* Separately schedules snapshots forgetting according to a policy

### Installation
```
docker plugin install --disable srgl/backer
docker plugin enable --timeout 120 srgl/backer
```

### Plugin options
###### size
Volume size, see `man truncate -s`, default `1G`
###### backup_schedule
Volume backup schedule, cron format, default `0 1 * * *`
###### restore
Should the volume be restored from the last snapshot before mount, y/n, default `n`
###### forget_policy
Snapshots forget policy, translates to `--keep-*` arguments for `restic forget`, default `l10 h24 d7 w52 m120 y100`
###### forget_schedule
Snapshots forget schedule, cron format, default `0 1 * * 0`
###### env_*
Every option with the `env_` prefix will be passed to the restic as an environment variable

### Example `docker-compose.yml`
```yaml
version: "3.7"
services:
  db:
    image: postgres:10-alpine
    volumes:
      - db_data:/var/lib/postgresql/data
volumes:
  db_data:
    driver: srgl/backer
    driver_opts:
      size: "2G"
      backup_schedule: "0 1 * * *"
      restore: "y"
      forget_policy: "l7 w30"
      forget_schedule: "0 1 * * 0"
      env_restic_repository: s3:s3.amazonaws.com/bucket/db_backups
      env_restic_password: $BACKUPS_PASSWORD
      env_aws_access_key_id: $AWS_ACCESS_KEY_ID
      env_aws_secret_access_key: $AWS_SECRET_ACCESS_KEY
```