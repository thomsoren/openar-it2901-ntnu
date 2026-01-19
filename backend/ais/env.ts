import dotenv from 'dotenv';
dotenv.config();

if (!process.env.AIS_TOKEN) {
  throw new Error("AIS_TOKEN is not defined in environment variables");
}

export const AIS_TOKEN = process.env.AIS_TOKEN;