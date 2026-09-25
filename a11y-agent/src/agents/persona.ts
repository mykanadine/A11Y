/**
 * Testing Persona dispatcher — Phase 3
 *
 * Routes each PersonaType to its dedicated simulator.
 * The Orchestrator calls runPersona() once per persona type
 * inside a Promise.all(), so all three run in parallel.
 */
import { PersonaReport, PersonaType } from "../types/index.js";
import { runMotorPersona } from "./personas/motor.js";
import { runVisualPersona } from "./personas/visual.js";
import { runVestibularPersona } from "./personas/vestibular.js";
import { UIComponent, ComplianceContext } from "../types/index.js";

export interface PersonaInput {
  persona: PersonaType;
  components: UIComponent[];
  complianceContext: ComplianceContext;
}

export async function runPersona(input: PersonaInput): Promise<PersonaReport> {
  switch (input.persona) {
    case "Motor":
      return runMotorPersona(input);
    case "Visual":
      return runVisualPersona(input);
    case "Vestibular/Cognitive":
      return runVestibularPersona(input);
    default: {
      const _exhaustive: never = input.persona;
      throw new Error(`Unknown persona: ${_exhaustive}`);
    }
  }
}
