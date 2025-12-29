import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  try {
    // Fecha de hoy
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    // Tickets totales
    const totalTickets = await prisma.ticket.count();

    // Tickets por estado
    const ticketsByStatus = await prisma.ticket.groupBy({
      by: ["status"],
      _count: true,
    });

    // Tickets por prioridad
    const ticketsByPriority = await prisma.ticket.groupBy({
      by: ["priority"],
      _count: true,
    });

    // Tickets creados hoy
    const ticketsToday = await prisma.ticket.count({
      where: {
        createdAt: { gte: today },
      },
    });

    // Tickets resueltos hoy
    const resolvedToday = await prisma.ticket.count({
      where: {
        status: "RESOLVED",
        updatedAt: { gte: today },
      },
    });

    // Tiempo promedio de resolución (en horas)
    const resolvedTickets = await prisma.ticket.findMany({
      where: {
        status: { in: ["RESOLVED", "CLOSED"] },
      },
      select: {
        createdAt: true,
        updatedAt: true,
      },
    });

    const avgResolutionTime = resolvedTickets.length > 0
      ? resolvedTickets.reduce((acc, t) => {
          const diff = t.updatedAt.getTime() - t.createdAt.getTime();
          return acc + diff / (1000 * 60 * 60); // convertir a horas
        }, 0) / resolvedTickets.length
      : 0;

    // Tickets urgentes sin asignar
    const urgentUnassigned = await prisma.ticket.count({
      where: {
        priority: "URGENT",
        assignedToUserId: null,
        status: { notIn: ["RESOLVED", "CLOSED"] },
      },
    });

    // Tickets por categoría
    const ticketsByCategory = await prisma.ticket.groupBy({
      by: ["category"],
      _count: true,
    });

    // Top 5 agentes por tickets asignados
    const topAgents = await prisma.agentUser.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        _count: {
          select: {
            tickets: {
              where: {
                status: { notIn: ["CLOSED"] },
              },
            },
          },
        },
      },
      orderBy: {
        tickets: {
          _count: "desc",
        },
      },
      take: 5,
    });

    // Tickets últimos 7 días (para gráfico de tendencias)
    const last7Days = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      date.setHours(0, 0, 0, 0);
      
      const nextDate = new Date(date);
      nextDate.setDate(nextDate.getDate() + 1);

      const count = await prisma.ticket.count({
        where: {
          createdAt: {
            gte: date,
            lt: nextDate,
          },
        },
      });

      last7Days.push({
        date: date.toISOString().split("T")[0],
        count,
      });
    }

    // Top 5 empresas con más tickets
    const topCompanies = await prisma.customer.findMany({
      select: {
        id: true,
        name: true,
        phone: true,
        _count: {
          select: {
            tickets: true,
          },
        },
      },
      orderBy: {
        tickets: {
          _count: "desc",
        },
      },
      take: 5,
    });

    return NextResponse.json({
      totalTickets,
      ticketsToday,
      resolvedToday,
      avgResolutionTime: Math.round(avgResolutionTime * 10) / 10,
      urgentUnassigned,
      ticketsByStatus: ticketsByStatus.map((s) => ({
        status: s.status,
        count: s._count,
      })),
      ticketsByPriority: ticketsByPriority.map((p) => ({
        priority: p.priority,
        count: p._count,
      })),
      ticketsByCategory: ticketsByCategory.map((c) => ({
        category: c.category,
        count: c._count,
      })),
      topAgents: topAgents.map((a) => ({
        id: a.id,
        name: a.name,
        email: a.email,
        activeTickets: a._count.tickets,
      })),
      last7Days,
      topCompanies: topCompanies.map((c) => ({
        id: c.id,
        name: c.name || c.phone,
        phone: c.phone,
        totalTickets: c._count.tickets,
      })),
    });
  } catch (error: any) {
    console.error("[Dashboard Stats] Error:", error);
    return NextResponse.json(
      { error: "Error al obtener estadísticas", details: error.message },
      { status: 500 }
    );
  }
}
