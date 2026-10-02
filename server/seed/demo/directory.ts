// Demo directory: four teams and six people (the first four have demo sign-ins, see index.ts).
export function demoTeams() {
  const teams = [
    { id: 'team-platform', name: 'Platform', color: 'purple', sample: true },
    { id: 'team-product', name: 'Product Experience', color: 'blue', sample: true },
    { id: 'team-growth', name: 'Growth', color: 'orange', sample: true },
    { id: 'team-data', name: 'Data', color: 'green', sample: true }
  ]
  return teams
}

export function demoPeople() {
  const people = [
    {
      id: 'p1',
      name: 'Maya Chen',
      email: 'maya@atlas.local',
      jobTitle: 'Engineering Manager',
      teamId: 'team-platform',
      focus: 'Release readiness and cross-team alignment',
      capacity: 78,
      status: 'On track',
      color: 'purple',
      sample: true
    },
    {
      id: 'p2',
      name: 'Noah Reed',
      email: 'noah@atlas.local',
      jobTitle: 'Senior Developer',
      teamId: 'team-platform',
      focus: 'API reliability and observability',
      capacity: 82,
      status: 'On track',
      color: 'blue',
      sample: true
    },
    {
      id: 'p3',
      name: 'Lina Patel',
      email: 'lina@atlas.local',
      jobTitle: 'Product Designer',
      teamId: 'team-product',
      focus: 'Onboarding interaction polish',
      capacity: 64,
      status: 'On track',
      color: 'pink',
      sample: true
    },
    {
      id: 'p4',
      name: 'Omar Haddad',
      email: 'omar@atlas.local',
      jobTitle: 'QA Lead',
      teamId: 'team-product',
      focus: 'Regression gates and risk checks',
      capacity: 91,
      status: 'Needs attention',
      color: 'orange',
      sample: true
    },
    {
      id: 'p5',
      name: 'Ella Brooks',
      email: 'ella@atlas.local',
      jobTitle: 'Data Engineer',
      teamId: 'team-data',
      focus: 'Delivery metrics warehouse',
      capacity: 70,
      status: 'On track',
      color: 'green',
      sample: true
    },
    {
      id: 'p6',
      name: 'Samir Khan',
      email: 'samir@atlas.local',
      jobTitle: 'Growth Engineer',
      teamId: 'team-growth',
      focus: 'Activation experiments',
      capacity: 58,
      status: 'On track',
      color: 'teal',
      sample: true
    }
  ]
  return people
}
