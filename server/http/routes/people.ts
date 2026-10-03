import type { Express } from 'express'
import type { Container } from '../../app/container'
import { handler } from '../../util'
import {
  parse,
  personCreateSchema,
  personUpdateSchema,
  teamCreateSchema,
  teamUpdateSchema
} from '../../validation/schemas'
import { auditContext, requirePermission, param } from '../context'

export function registerPeopleRoutes(http: Express, app: Container) {
  const need = (permission: string | string[], message?: string) => requirePermission(app, permission, message)

  http.post(
    '/api/people',
    need('managePeople'),
    handler((req, res) => res.json(app.people.createPerson(parse(personCreateSchema, req.body), auditContext(req))))
  )
  http.put(
    '/api/people/:id',
    need('managePeople'),
    handler((req, res) =>
      res.json(app.people.updatePerson(param(req), parse(personUpdateSchema, req.body), auditContext(req)))
    )
  )
  http.delete(
    '/api/people/:id',
    need('managePeople'),
    handler((req, res) => res.json(app.people.deletePerson(param(req), auditContext(req))))
  )

  http.post(
    '/api/teams',
    need('managePeople'),
    handler((req, res) => res.json(app.people.createTeam(parse(teamCreateSchema, req.body), auditContext(req))))
  )
  http.put(
    '/api/teams/:id',
    need('managePeople'),
    handler((req, res) =>
      res.json(app.people.updateTeam(param(req), parse(teamUpdateSchema, req.body), auditContext(req)))
    )
  )
  http.delete(
    '/api/teams/:id',
    need('managePeople'),
    handler((req, res) => {
      app.people.deleteTeam(param(req), auditContext(req))
      res.json({ ok: true })
    })
  )
}
