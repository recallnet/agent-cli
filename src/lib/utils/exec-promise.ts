import { exec } from 'child_process';
import { promisify } from 'util';

/**
 * Promisified version of the child_process.exec function
 * Allows using exec with async/await
 */
export const execPromise = promisify(exec); 