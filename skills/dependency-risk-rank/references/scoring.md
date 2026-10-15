# Risk score (0 to 100)

The score is the sum of the components below, capped at 100.

| Component                                                                 | Points                                                     | Cap |
| ------------------------------------------------------------------------- | ---------------------------------------------------------- | --- |
| Each vulnerability, by severity                                           | critical 30, high 20, moderate/medium 10, low 4, unknown 6 | 50  |
| Package deprecated on the registry                                        | 25                                                         | 25  |
| Days since the installed version's newest release line was last published | > 1095: 15, > 730: 10, > 365: 5                            | 15  |
| Maintainers                                                               | 1 maintainer: 5, none listed: 3                            | 5   |
| Major versions behind latest                                              | 5 per major                                                | 10  |
| Transitive weight                                                         | `transitiveCount / 10`                                     | 10  |

Vulnerabilities are de-duplicated by ID and alias across npm audit, OSV-Scanner and Trivy before scoring.

Ties are broken by vulnerability count, then by name.
