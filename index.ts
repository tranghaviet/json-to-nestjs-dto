import * as fs from "fs";
import * as path from "path";
import { camelCase, upperFirst } from "lodash";

const args = process.argv.slice(2);

if (args.length === 0) {
  console.log("Usage: npm run convert <json-file-path> [output-directory] [root-dto-name]");
  console.log("Example: npm run convert ./example.json ./generated-dtos RootDto");
  process.exit(1);
}

const jsonFilePath = args[0];
const outputDir = args[1] || "./dist/generated-dtos";
const rootDtoName = args[2] || "RootDto";

// Configuration
const indent = "  ";

// Type mappings for class-validator
const typeToValidator: { [key: string]: string } = {
  string: "IsString",
  number: "IsNumber",
  boolean: "IsBoolean",
  object: "IsObject",
  array: "IsArray",
};

// Ensure output directory exists
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Read and parse JSON file
console.log(`Reading JSON file: ${jsonFilePath}`);
const jsonData = JSON.parse(fs.readFileSync(jsonFilePath, "utf-8"));

// Interface for DTO property
interface DtoProperty {
  name: string;
  type: string;
  isArray: boolean;
  isObject: boolean;
  example: any;
  nestedDtoName?: string;
}

// Generate DTO class content
function generateDtoClass(
  className: string,
  properties: DtoProperty[]
): string {
  let imports = [
    "import { ApiProperty } from '@nestjs/swagger';",
    "import { Expose, Type } from 'class-transformer';",
    "import { IsArray, IsBoolean, IsNumber, IsObject, IsString, ValidateNested } from 'class-validator';",
  ];
  let nestedImports: string[] = [];

  // Collect nested DTO imports
  properties.forEach((prop) => {
    if (prop.nestedDtoName) {
      nestedImports.push(
        // `import { ${prop.nestedDtoName} } from './${camelCase(
        //   prop.nestedDtoName
        // )}.dto';`
        `import { ${prop.nestedDtoName} } from './${prop.nestedDtoName}.dto';`
      );
    }
  });

  if (nestedImports.length) {
    imports = [...imports, ...nestedImports];
  }

  let classContent = properties
    .map((prop) => {
      const decorators = [
        `@ApiProperty({ example: ${JSON.stringify(
          prop.example,
          null,
          2
        ).replace(/\n/g, `\n`)} })`,
        `@Expose({ name: '${prop.name}' })`,
      ];

      if (prop.isObject && prop.nestedDtoName) {
        decorators.push(
          `@ValidateNested(${prop.isArray ? "{ each: true }" : ""})`
        );
        decorators.push(`@Type(() => ${prop.nestedDtoName})`);
      } else {
        if (prop.isArray && !prop.nestedDtoName) {
          decorators.push("@IsArray()");
        }

        const validator = typeToValidator[prop.type] || "IsString";
        decorators.push(
          `@${validator}(${prop.isArray ? "{ each: true }" : ""})`
        );
      }

      const property = `${camelCase(prop.name)}: ${prop.type}${
        prop.isArray ? "[]" : ""
      };`;

      return `${[...decorators, property]
        .map((e) => `${indent}${e}`)
        .join(`\n`)}`;
    })
    .join("\n\n");

  return `${imports.join(
    "\n"
  )}\n\nexport class ${className} {\n${classContent}\n}`;
}

// Process JSON to create DTO properties
function processJsonProperties(
  data: any,
  prefix: string = ""
): { props: DtoProperty[]; nestedDtos: Map<string, DtoProperty[]> } {
  const props: DtoProperty[] = [];
  const nestedDtos = new Map<string, DtoProperty[]>();

  for (const [key, value] of Object.entries(data) as [string, any][]) {
    const prop: DtoProperty = {
      name: key,
      type: "string",
      isArray: Array.isArray(value),
      isObject: false,
      example: value,
    };

    let actualValue = prop.isArray && value.length ? value[0] : value;

    if (
      actualValue !== null &&
      typeof actualValue === "object" &&
      !Array.isArray(actualValue)
    ) {
      prop.isObject = true;
      prop.nestedDtoName = upperFirst(camelCase(`${prefix}-${key}`));
      prop.type = prop.nestedDtoName;

      const nestedResult = processJsonProperties(
        actualValue,
        `${prefix}-${key}`
      );
      nestedDtos.set(prop.nestedDtoName, nestedResult.props);
      nestedResult.nestedDtos.forEach((nestedProps, nestedName) => {
        nestedDtos.set(nestedName, nestedProps);
      });
    } else {
      if (
        prop.isArray &&
        actualValue !== undefined &&
        typeof actualValue === "object"
      ) {
        prop.isObject = true;
        prop.nestedDtoName = upperFirst(camelCase(`${prefix}-${key}`));
        prop.type = prop.nestedDtoName;

        const nestedResult = processJsonProperties(
          actualValue,
          `${prefix}-${key}`
        );
        nestedDtos.set(prop.nestedDtoName, nestedResult.props);
        nestedResult.nestedDtos.forEach((nestedProps, nestedName) => {
          nestedDtos.set(nestedName, nestedProps);
        });
      } else {
        prop.type = Array.isArray(value)
          ? typeof (value.length ? value[0] : "string")
          : typeof value;
      }
    }

    props.push(prop);
  }

  return { props, nestedDtos };
}

// Generate all DTO files
function generateDtoFiles(data: any, mainClassName: string) {
  // const { props, nestedDtos } = processJsonProperties(data, mainClassName);
  const { props, nestedDtos } = processJsonProperties(data);
  console.log(`Found ${nestedDtos.size} classes to generate`);

  console.log("\nGenerated files:");
  // Generate nested DTOs
  nestedDtos.set(mainClassName, props);
  nestedDtos.forEach((nestedProps, nestedClassName) => {
    const nestedDtoContent = generateDtoClass(nestedClassName, nestedProps);
    const targetFilePath = path.join(outputDir, `${nestedClassName}.dto.ts`);
    console.log(`  - ${nestedClassName} -> ${targetFilePath}`);
    fs.writeFileSync(targetFilePath, nestedDtoContent);
  });
}

generateDtoFiles(jsonData, rootDtoName);
